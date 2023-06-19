import { EventEmitter } from 'events'
import APIRequest from './APIRequest';
import { IncomingHttpHeaders } from 'http';
import { FetchResponse } from './types/FetchResponse';
import PQueue from 'p-queue';
import { RateLimitError, RequestTimeoutError } from './errors';
import {TimeoutError} from 'p-timeout'

declare interface BucketAsync {
  emit(event: 'recognizeURLBucket', url: string, bucketId: string): boolean
  emit(event: 'finishedAll'): boolean
  emit(event: 'rateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'globalRateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'cloudflareRateLimit', apiRequest: APIRequest, blockedDurationMs: number, debugDetails: Record<string, any>): boolean
  emit(event: 'invalidRequest', apiRequest: APIRequest): boolean;
  emit(event: 'jobFinished', apiRequest: APIRequest, response: FetchResponse): boolean
  on(event: 'recognizeURLBucket', listener: (url: string, bucketId: string) => void): this
  on(event: 'finishedAll', listener: () => void): this
  on(event: 'rateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this
  on(event: 'globalRateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this
  on(event: 'cloudflareRateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number, debugDetails: Record<string, any>) => void): this
  on(event: 'invalidRequest', listener: (apiRequest: APIRequest) => void): this
  on(event: 'jobFinished', listener: (apiRequest: APIRequest, response: FetchResponse) => void): this
}

/**
 * Handles queuing and exectuion of API requests that share
 * the same rate limits
 */
class BucketAsync extends EventEmitter {
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
   * Debug logger
   */
  private readonly queue = new PQueue({
    carryoverConcurrencyCount: true,
    concurrency: 1,
    throwOnTimeout: true,
    timeout: 1000 * 60 * 5
  })

  constructor (id: string) {
    super()
    this.id = id

    this.queue.on('idle', () => {
      this.emit('finishedAll')
    })
  }

  /**
   * Discord header constants
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  static get constants () {
    return {
      // The bucket id encountered
      RATELIMIT_BUCKET: 'x-ratelimit-bucket',
      // Number of remaining requests for this bucket
      RATELIMIT_REMAINING: 'x-ratelimit-remaining',
      // Seconds to wait until the limit resets
      RATELIMIT_RESET_AFTER: 'x-ratelimit-reset-after',
      // If the encountered route has hit a global limit
      RATELIMIT_GLOBAL: 'x-ratelimit-global',
      // Seconds to wait until global limit is reset
      // Only available when a global limit is hit
      RETRY_AFTER: 'retry-after'
    }
  }
  
  /**
   * Create a bucket's ID using major route parameters and the bucket
   * header defined in X-RateLimit-BucketAsync. If it cannot be resolved,
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
    return this.queue.size > 0
  }

  /**
   * If a bucket limit is available within these headers from request headers
   */
  static hasBucketLimits (headers: IncomingHttpHeaders): boolean {
    const {
      RATELIMIT_BUCKET
    } = BucketAsync.constants
    return !!headers[RATELIMIT_BUCKET]
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
  static getBucketBlockDurationMs (headers: IncomingHttpHeaders, ignoreRemaining: boolean): number {
    const {
      RATELIMIT_REMAINING,
      RATELIMIT_RESET_AFTER
    } = BucketAsync.constants
    const rateLimitRemaining = Number(headers[RATELIMIT_REMAINING])
    if (rateLimitRemaining === 0 || ignoreRemaining) {
      // Reset-After contains seconds
      const resetAfterMs = Number(headers[RATELIMIT_RESET_AFTER]) * 1000
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
  static isGloballyBlocked (headers: IncomingHttpHeaders): boolean {
    const {
      RATELIMIT_GLOBAL
    } = BucketAsync.constants
    return !!headers[RATELIMIT_GLOBAL]
  }

  /**
   * Determine how long in ms the global block is from request headers
   * Returns -1 if no block duration is found in headers. Discord returns
   * this value as milliseconds.
   * 
   * @returns {number} Milliseconds.
   */
  static getGlobalBlockDurationMs (headers: IncomingHttpHeaders): number {
    const {
      RETRY_AFTER
    } = BucketAsync.constants
    const retryAfterMs = Number(headers[RETRY_AFTER])
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
  static getBlockedDuration (headers: IncomingHttpHeaders, ignoreRemaining = false): number {
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
  private recognizeURLBucket (url: string, headers: IncomingHttpHeaders): void {
    if (!BucketAsync.hasBucketLimits(headers)) {
      return
    }
    const {
      RATELIMIT_BUCKET
    } = BucketAsync.constants
    const rateLimitBucket = String(headers[RATELIMIT_BUCKET] || '')
    const bucketID = BucketAsync.resolveBucketId(url, rateLimitBucket)
    this.emit('recognizeURLBucket', url, bucketID)
  }

  /**
   * Block this bucket from executing new requests for a duration
   */
  public block (durationMs: number): void {
    this.queue.pause()
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
   * Copys the block to another bucketAsync. Used when a new bucket will
   * replace a temporary bucket, but the temporary bucket still has
   * a block on it. The block is then transferred from the temporary
   * bucket to the new one.
   */
  public copyBlockTo (otherBucket: BucketAsync): void {
    if (!this.blockedUntil) {
      return
    }
    const now = new Date().getTime()
    const future = this.blockedUntil.getTime()
    const diff = future - now
    otherBucket.block(diff)
  }


  /**
   * Wait for previous API requests to finish
   */
  async waitForRequest (apiRequest: APIRequest, options?: {
    debugHistory?: string[]
  }): Promise<void> {
    if (!apiRequest) {
      options?.debugHistory?.push(`Not waiting for any request since there is no previous api request`)
      return
    }

    options?.debugHistory?.push(`Waiting for request ${apiRequest?.route} before executing`)
    return new Promise((resolve) => {
      this.once(`finishedRequest-${apiRequest.id}`, resolve)
    })
  }

  /**
   * Queue up an API request for execution.
   * 
   * This function must not be prefixed with async since
   * the queue push must be synchronous
   * 
   * @returns Node fetch response
   */
  public async enqueue (apiRequest: APIRequest): Promise<void> {
    if (this.queue.isPaused) {
      return
    }

    try {
      await this.queue.add(async () => this.execute(apiRequest))
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new RequestTimeoutError('Request timed out', [])
      } else {
        throw err
      }
    }
  }

  /**
   * Clear all requests from the queue.
   */
  clear(): void {
    this.queue.clear()
  }

  /**
   * Execute a APIRequest by fetching it
   */
  async execute (apiRequest: APIRequest): Promise<void> {
    const res = await apiRequest.execute()
    const { status, headers } = res
    
    this.recognizeURLBucket(apiRequest.route, headers)
    if (status === 429) {
      await this.handle429Response(apiRequest, res)
    } else {
      await this.handleResponse(apiRequest, res)
    }
  }

  /**
   * Handle 429 status code response (rate limited)
   */
  private async handle429Response (apiRequest: APIRequest, res: FetchResponse): Promise<void> {
    const { headers } = res
    let blockedDurationMs = BucketAsync.getBlockedDuration(headers, true)

    if (BucketAsync.isGloballyBlocked(headers)) {
      this.emit('globalRateLimit', apiRequest, blockedDurationMs)
    } else {
      this.emit('rateLimit', apiRequest, blockedDurationMs)
    }

    if (blockedDurationMs === -1) {
      // Typically when the IP has been blocked by Cloudflare. Wait 3 hours if this happens.
      blockedDurationMs = 1000 * 60 * 60 * 3
      this.emit('cloudflareRateLimit', apiRequest, blockedDurationMs, {
        headers
      })

      throw new RateLimitError()
    }

    /**
     * 429 is considered an invalid request, and is counted towards
     * a hard limit that will result in an temporary IP ban if
     * exceeded
     */
    this.emit('invalidRequest', apiRequest)

    this.block(blockedDurationMs)

    throw new RateLimitError()
  }

  /**
   * Handle any responses that is not a rate limit block
   */
  private async handleResponse (apiRequest: APIRequest, res: FetchResponse): Promise<void> {
    /**
     * 401 and 403 are considered invalid requests, and are counted
     * towards a hard limit that will result in a temporary IP ban
     * if exceeded
     */
    if (res.status === 401 || res.status === 403) {
      this.emit('invalidRequest', apiRequest)
    }

    const blockedDurationMs = BucketAsync.getBlockedDuration(res.headers)

    
    if (blockedDurationMs !== -1) {
      this.block(blockedDurationMs)

      throw new RateLimitError()
    }

    this.emit('jobFinished', apiRequest, res)
  }
}

export default BucketAsync
