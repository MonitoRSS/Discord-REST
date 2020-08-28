import { EventEmitter } from 'events'
import RESTExecutor from './RESTHandler'
import APIRequest from './APIRequest';
import { Headers, Response } from 'node-fetch';
import { Debugger } from 'debug';
import { createBucketDebug } from './util/debug';

class Bucket extends EventEmitter {
  restExecutor: RESTExecutor
  id: string
  blockedUntil?: Date
  private timer?: NodeJS.Timeout
  private readonly queue: APIRequest[] = []
  private readonly debug: Debugger

  constructor (restExecutor: RESTExecutor, id: string) {
    super()
    this.restExecutor = restExecutor
    this.id = id
    this.debug = createBucketDebug(id)
  }

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
   * Determine how long the bucket block is from request headers
   * Returns seconds.
   */
  static getBucketBlockDuration (headers: Headers): number {
    const {
      RATELIMIT_REMAINING,
      RATELIMIT_RESET_AFTER
    } = Bucket.constants
    const rateLimitRemaining = Number(headers.get(RATELIMIT_REMAINING))
    if (rateLimitRemaining === 0) {
      // Reset-After contains seconds
      const resetAfter = Number(headers.get(RATELIMIT_RESET_AFTER)) * 1000
      if (isNaN(resetAfter)) {
        return -1
      } else {
        return resetAfter
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
   * Determine how long the global block is from request headers
   */
  static getGlobalBlockDuration (headers: Headers): number {
    const {
      RETRY_AFTER
    } = Bucket.constants
    const retryAfter = Number(headers.get(RETRY_AFTER))
    if (!isNaN(retryAfter)) {
      return retryAfter
    }
    return -1
  }

  /**
   * Determine how long to block this bucket from request
   * headers before executing any further requests
   */
  static getBlockedDuration (headers: Headers): number {
    // Global limits take priority
    if (this.isGloballyBlocked(headers)) {
      return this.getGlobalBlockDuration(headers)
    } else if (this.hasBucketLimits(headers)) {
      return this.getBucketBlockDuration(headers)
    } else {
      return -1
    }
  }

  /**
   * Emit the bucket ID from request headers as an event for
   * the RESTExecutor to map a url to its bucket in the future
   */
  private recognizeURLBucket (url: string, headers: Headers): void {
    if (!Bucket.hasBucketLimits(headers)) {
      return
    }
    const {
      RATELIMIT_BUCKET
    } = Bucket.constants
    const bucketID = headers.get(RATELIMIT_BUCKET)
    this.emit('recognizeURLBucket', url, bucketID)
  }

  /**
   * Block this executor from further requests for a duration
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
   * Copys the block to another bucket. Used when temporary
   * buckets are removed, but still has a block on them
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
   * @param {import('./APIRequest.JS')} apiRequest
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
   */
  public enqueue (apiRequest: APIRequest): Promise<Response> {
    /**
     * This function must not be prefixed with async since
     * the queue push must be synchronous
     */
    this.debug(`Enqueuing request ${apiRequest.toString()}`)
    const previousRequest = this.queue[this.queue.length - 1]
    this.queue.push(apiRequest)
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        await this.waitForRequest(previousRequest)
        const result = await this.execute(apiRequest)
        this.queue.splice(this.queue.indexOf(apiRequest), 1)
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
    this.emit(`finishedRequest-${apiRequest.id}`)
  }

  /**
   * Handle 429 status code response (rate limited)
   */
  private async handle429Response (apiRequest: APIRequest, res: Response): Promise<Response> {
    const { headers } = res
    const blockedDuration = Bucket.getBlockedDuration(headers)
    this.emit('429', apiRequest)
    this.debug(`429 hit for ${apiRequest.toString()}`)
    if (blockedDuration === -1) {
      throw new Error('429 response')
    }
    if (Bucket.isGloballyBlocked(headers)) {
      this.debug(`Global limit was hit after ${apiRequest.toString()}`)
      this.emit('globalLimit', blockedDuration)
    }
    this.debug(`Blocking for ${blockedDuration} seconds after 429 response for ${apiRequest.toString()}`)
    this.block(blockedDuration)
    const futureResult = await this.delayExecution(apiRequest)
    return futureResult
  }

  /**
   * Handle any responses that is not a rate limit block
   */
  private async handleResponse (apiRequest: APIRequest, res: Response): Promise<Response> {
    this.debug(`Non-429 response for ${apiRequest.toString()}`)
    const blockedDuration = Bucket.getBlockedDuration(res.headers)
    if (blockedDuration !== -1) {
      this.debug(`Blocking for ${blockedDuration}s after non-429 response for ${apiRequest.toString()}`)
      this.block(blockedDuration)
    }
    return res
  }
}

export default Bucket
