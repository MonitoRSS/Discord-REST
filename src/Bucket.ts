import { EventEmitter } from 'events'
import APIRequest from './APIRequest';
import { Headers, Response } from 'node-fetch';
import { Debugger } from 'debug';
import { createBucketDebug } from './util/debug';

declare interface Bucket {
  emit(event: 'recognizeURLBucket', url: string, bucketId: string): boolean
  emit(event: 'finishedAll'): boolean
  emit(event: 'rateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'globalRateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'invalidRequest', apiRequest: APIRequest): boolean;
  on(event: 'recognizeURLBucket', listener: (url: string, bucketId: string) => void): this
  on(event: 'finishedAll', listener: () => void): this
  on(event: 'rateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this
  on(event: 'globalRateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this
  on(event: 'invalidRequest', listener: (apiRequest: APIRequest) => void): this
}

/**
 * Handles queuing and exectuion of API requests that share
 * the same rate limits
 */
class Bucket extends EventEmitter {
  /**
   * The bucket ID. If it is a temporary bucket whose actual
   * ID has not been returned from Discord, it would be the
   * route string itself. Otherwise, it's a resolved string
   * that takes into account the bucket header returned in
   * Discord's headers combined with major route parameters
   */
  id: string
  /**
   * The date until this bucket can start processing requests
   * within its queue again.
   */
  blockedUntil?: Date
  /**
   * A timer that clears blockedUntil to allow processing
   * again
   */
  private timer?: NodeJS.Timeout
  /**
   * The queue of pending API requests
   */
  private readonly queue: APIRequest[] = []
  /**
   * Debug logger
   */
  private readonly debug: Debugger

  constructor (id: string) {
    super()
    this.id = id
    this.debug = createBucketDebug(id)
  }

  /**
   * Discord header constants
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  static get constants () {
    return {
      // The bucket id encountered
      RATELIMIT_BUCKET: 'X-RateLimit-Bucket',
      // Number of remaining requests for this bucket
      RATELIMIT_REMAINING: 'X-RateLimit-Remaining',
      // Seconds to wait until the limit resets
      RATELIMIT_RESET_AFTER: 'X-RateLimit-Reset-After',
      // If the encountered route has hit a global limit
      RATELIMIT_GLOBAL: 'X-RateLimit-Global',
      // Seconds to wait until global limit is reset
      // Only available when a global limit is hit
      RETRY_AFTER: 'Retry-After'
    }
  }
  
  /**
   * Create a bucket's ID using major route parameters and the bucket
   * header defined in X-RateLimit-Bucket. If it cannot be resolved,
   * use the route as the bucket ID.
   * 
   * @param route API Route
   * @param rateLimitBucket Bucket defined in X-RateLimit-Bucket header
   */
  static resolveBucketId (route: string, rateLimitBucket?: string): string {
    const guildId = route.match(/\/guilds\/(\d+)/)?.[1] || ''
    const channelId = route.match(/\/channels\/(\d+)/)?.[1] || ''
    const webhookId = route.match(/\/webhooks\/(\d+)/)?.[1] || ''
    const headerBucket = rateLimitBucket || ''
    const firstTry = [headerBucket, guildId, channelId, webhookId]
    if (firstTry.filter(item => item).length > 0) {
      return firstTry.join('-')
    } else {
      return route
    }
  }

  /**
   * If there are queued up requests in this bucket
   */
  public hasPendingRequests (): boolean {
    return this.queue.length > 0
  }

  /**
   * If a bucket limit is available within these headers from request headers
   */
  static hasBucketLimits (headers: Headers): boolean {
    const {
      RATELIMIT_BUCKET
    } = Bucket.constants
    return !!headers.get(RATELIMIT_BUCKET)
  }

  /**
   * Determine how long the bucket block is in ms from request headers.
   * Discord may also still return 429 if remaining is >0. We ignore
   * remaining in the event of a 429 response. Discord returns the
   * duration as seconds.
   * 
   * Returns -1 if no block duration is found in headers
   * 
   * @returns {number} Milliseconds
   */
  static getBucketBlockDurationMs (headers: Headers, ignoreRemaining: boolean): number {
    const {
      RATELIMIT_REMAINING,
      RATELIMIT_RESET_AFTER
    } = Bucket.constants
    const rateLimitRemaining = Number(headers.get(RATELIMIT_REMAINING))
    if (rateLimitRemaining === 0 || ignoreRemaining) {
      // Reset-After contains seconds
      const resetAfterMs = Number(headers.get(RATELIMIT_RESET_AFTER)) * 1000
      if (isNaN(resetAfterMs)) {
        return -1
      } else {
        return resetAfterMs
      }
    }
    return -1
  }

  /**
   * If the headers indicate global blockage from request headers
   */
  static isGloballyBlocked (headers: Headers): boolean {
    const {
      RATELIMIT_GLOBAL
    } = Bucket.constants
    return !!headers.get(RATELIMIT_GLOBAL)
  }

  /**
   * Determine how long in ms the global block is from request headers
   * Returns -1 if no block duration is found in headers. Discord returns
   * this value as milliseconds.
   * 
   * @returns {number} Milliseconds.
   */
  static getGlobalBlockDurationMs (headers: Headers): number {
    const {
      RETRY_AFTER
    } = Bucket.constants
    const retryAfterMs = Number(headers.get(RETRY_AFTER))
    if (!isNaN(retryAfterMs)) {
      return retryAfterMs
    }
    return -1
  }

  /**
   * Determine how long to block this bucket in ms from
   * request headers before executing any further requests
   * Returns -1 if no block duration is found in headers
   * 
   * @returns {number} Milliseconds
   */
  static getBlockedDuration (headers: Headers, ignoreRemaining = false): number {
    // Global limits take priority
    if (this.isGloballyBlocked(headers)) {
      return this.getGlobalBlockDurationMs(headers)
    } else if (this.hasBucketLimits(headers)) {
      return this.getBucketBlockDurationMs(headers, ignoreRemaining)
    } else {
      return -1
    }
  }

  /**
   * Emit the bucket ID from request headers as an event for
   * the RESTHandler to map a url to its bucket in the future.
   * 
   * API requests by default are allocated to temporary buckets.
   * Recognizing it will de-allocate it from the temporary buckets.
   */
  private recognizeURLBucket (url: string, headers: Headers): void {
    if (!Bucket.hasBucketLimits(headers)) {
      return
    }
    const {
      RATELIMIT_BUCKET
    } = Bucket.constants
    const rateLimitBucket = headers.get(RATELIMIT_BUCKET) || ''
    const bucketID = Bucket.resolveBucketId(url, rateLimitBucket)
    this.emit('recognizeURLBucket', url, bucketID)
  }

  /**
   * Block this bucket from executing new requests for a duration
   */
  public block (durationMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    const nowMs = new Date().getTime()
    this.blockedUntil = new Date(nowMs + durationMs)
    this.timer = setTimeout(() => {
      this.blockedUntil = undefined
    }, durationMs)
  }

  /**
   * Copys the block to another bucket. Used when a new bucket will
   * replace a temporary bucket, but the temporary bucket still has
   * a block on it. The block is then transferred from the temporary
   * bucket to the new one.
   */
  public copyBlockTo (otherBucket: Bucket): void {
    if (!this.blockedUntil) {
      return
    }
    const now = new Date().getTime()
    const future = this.blockedUntil.getTime()
    const diff = future - now
    otherBucket.block(diff)
  }

  /**
   * Delay the execution and resolution of an API request
   */
  private async delayExecution (apiRequest: APIRequest): Promise<Response> {
    const now = new Date().getTime()
    const future = (this.blockedUntil as Date).getTime()
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.execute(apiRequest))
      }, future - now)
    })
  }

  /**
   * Wait for previous API requests to finish
   */
  private async waitForRequest (apiRequest: APIRequest): Promise<void> {
    if (!apiRequest) {
      return
    }
    return new Promise((resolve) => {
      this.once(`finishedRequest-${apiRequest.id}`, resolve)
    })
  }

  /**
   * Queue up an API request for execution.
   * 
   * @returns Node fetch response
   */
  public enqueue (apiRequest: APIRequest): Promise<Response> {
    /**
     * This function must not be prefixed with async since
     * the queue push must be synchronous
     */
    this.debug(`Enqueuing request ${apiRequest.toString()}`)
    /**
     * Access the last one in the queue *before* we enter the
     * promise since the call is synchronous with this part of
     * the function.
     */
    const previousRequest = this.queue[this.queue.length - 1]
    this.queue.push(apiRequest)
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        /**
         * Every request waits for the previous request in a
         * recursive-like pattern, and is guaranteed to only
         * be executed after all previous requests were executed
         */
        await this.waitForRequest(previousRequest)
        const result = await this.execute(apiRequest)
        this.queue.splice(this.queue.indexOf(apiRequest), 1)
        /**
         * If the queue is empty, emit an event that allows the
         * RESTHandler to delete this bucket if it is pending deletion
         */
        if (this.queue.length === 0) {
          this.debug('Finished entire queue')
          this.emit('finishedAll')
        }
        resolve(result)
      } catch (err) {
        reject(err)
      } finally {
        this.debug(`Finished ${apiRequest.toString()}`)
        this.finishHandling(apiRequest)
      }
    })
  }

  /**
   * Execute a APIRequest by fetching it
   */
  private async execute (apiRequest: APIRequest): Promise<Response> {
    if (this.blockedUntil) {
      this.debug(`Delaying execution until ${this.blockedUntil} for ${apiRequest.toString()}`)
      return this.delayExecution(apiRequest)
    }
    this.debug(`Executing ${apiRequest.toString()}`)
    const res = await apiRequest.execute()
    const { status, headers } = res
    this.recognizeURLBucket(apiRequest.route, headers)
    if (status === 429) {
      return this.handle429Response(apiRequest, res)
    } else {
      return this.handleResponse(apiRequest, res)
    }
  }

  /**
   * Mark an API request as finished to proceed with the queue
   * for other enqueued requests
   */
  private finishHandling (apiRequest: APIRequest): void {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.emit(`finishedRequest-${apiRequest.id}`)
  }

  /**
   * Handle 429 status code response (rate limited)
   */
  private async handle429Response (apiRequest: APIRequest, res: Response): Promise<Response> {
    const { headers } = res
    const blockedDurationMs = Bucket.getBlockedDuration(headers, true)
    this.debug(`429 hit for ${apiRequest.toString()}`)
    if (Bucket.isGloballyBlocked(headers)) {
      this.debug(`Global limit was hit after ${apiRequest.toString()}`)
      this.emit('globalRateLimit', apiRequest, blockedDurationMs)
    } else {
      this.emit('rateLimit', apiRequest, blockedDurationMs)
    }
    if (blockedDurationMs === -1) {
      throw new Error('429 response with no blocked duration')
    }
    /**
     * 429 is considered an invalid request, and is counted towards
     * a hard limit that will result in an temporary IP ban if
     * exceeded
     */
    this.emit('invalidRequest', apiRequest)
    this.debug(`Blocking for ${blockedDurationMs}ms after 429 response for ${apiRequest.toString()}`)
    this.block(blockedDurationMs)
    const futureResult = await this.delayExecution(apiRequest)
    return futureResult
  }

  /**
   * Handle any responses that is not a rate limit block
   */
  private async handleResponse (apiRequest: APIRequest, res: Response): Promise<Response> {
    this.debug(`Non-429 response for ${apiRequest.toString()}`)
    const blockedDurationMs = Bucket.getBlockedDuration(res.headers)
    if (blockedDurationMs !== -1) {
      this.debug(`Blocking for ${blockedDurationMs}ms after non-429 response for ${apiRequest.toString()}`)
      this.block(blockedDurationMs)
    }
    /**
     * 401 and 403 are considered invalid requests, and are counted
     * towards a hard limit that will result in a temporary IP ban
     * if exceeded
     */
    if (res.status === 401 || res.status === 403) {
      this.emit('invalidRequest', apiRequest)
    }
    return res
  }
}

export default Bucket
