import Bucket from "./Bucket"
import { RequestInit, Response } from "node-fetch";
import APIRequest from "./APIRequest";
import { EventEmitter } from "events";

export type RESTHandlerOptions = {
  /**
   * Maximum number of invalid requests allowed within 10
   * minutes before delaying all further requests by
   * 10 minutes.
   * 
   * Default is half of the hard limit, where the hard limit
   * is 10,000
   */
  invalidRequestsThreshold?: number,
  /**
   * Whether to delay all requests by 10 minutes when the
   * invalid requests threshold is reached
   */
  delayOnInvalidThreshold?: boolean,
  /**
   * Milliseconds to wait for an API request before automatically
   * timing it out
   */
  requestTimeout?: number,
  /**
   * Number of request retries on API request timeouts
   */
  requestTimeoutRetries?: number,
  /**
   * Multiple of the duration to block the queue by when a global
   * limit is hit. It could be safer to block longer than what Discord
   * suggests for safety.
   * 
   * Default is 1
   */
  globalBlockDurationMultiple?: number
  /**
   * Maximum number of requests to execute per second.
   * 
   * Default is 50 since it is the maximum allowed by Discord
   * https://discord.com/developers/docs/topics/rate-limits#global-rate-limit
   */
  maxRequestsPerSecond?: number
  /**
   * Name of the queue to be stored in Redis
   */
  queueName?: string
}

declare interface RESTHandler {
  emit(event: 'rateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'globalRateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'invalidRequest', apiRequest: APIRequest, countSoFar: number): boolean
  emit(event: 'idle'|'active'): boolean
  emit(event: 'invalidRequestsThreshold', threshold: number): boolean
  emit(event: 'cloudflareRateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  /**
   * When a bucket rate limit is encountered
   */
  on(event: 'rateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this;
  /**
   * When a global rate limit is encountered
   */
  on(event: 'globalRateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this;
  /**
   * When an invalid request that count towards a hard limit
   * is encountered.
   */
  on(event: 'invalidRequest', listener: (apiRequest: APIRequest, countSoFar: number) => void): this
  /**
   * When the number of invalid requests threshold has been reached,
   * all requests are delayed by 10 minutes
   */
  on(event: 'invalidRequestsThreshold', listener: (threshold: number) => void): this
  /**
   * When the IP has likely been banned for several hours after exceeding the maximum rate
   * limits allowed within a duration.
   */
  on(event: 'cloudflareRateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this;
}

/**
 * The entry point for all requests
 */
class RESTHandler extends EventEmitter {
  /**
   * Buckets mapped by IDs, where the IDs are the routes
   * themselves. This is the default bucket type that is
   * used for every route until their actual bucket is
   * known after a fetch.
   */
  private readonly temporaryBucketsByUrl: Map<string, Bucket> = new Map()
  /**
   * Buckets mapped by their IDs, where the IDs are
   * resolved based on route major parameters and the
   * X-RateLimit-Bucket header returned by Discord.
   */
  private readonly buckets: Map<string, Bucket> = new Map()
  /**
   * Buckets mapped by the route URLs. These buckets are
   * considered the "true" buckets for their specified
   * routes since their IDs were returned by Discord.
   * 
   * This is a convenience map that is made alongside
   * the "buckets" instance variable whenever subsequent
   * requests are made.
   */
  private readonly bucketsByUrl: Map<string, Bucket> = new Map()
  /**
   * Number of invalid requests made within 10 minutes. If
   * the number of invalid requests reaches a certain hard
   * limit (specified by Discord - currently 10,000),
   * Discord will block the application's IP from accessing
   * its API.
   */
  private invalidRequestsCount = 0
  /**
   * Maximum number of invalid requests allowed within 10
   * minutes before delaying all further requests by
   * 10 minutes.
   * 
   * Default is half the hard limit, where the hard limit
   * is 10,000
   */
  private readonly invalidRequestsThreshold: number
  /**
   * Multiply the global block duration by this number whenever
   * a global rate limit is hit
   */
  private readonly globalBlockDurationMultiple: number
  private readonly userOptions: RESTHandlerOptions

  constructor (options?: RESTHandlerOptions) {
    super()
    this.userOptions = options || {}
    this.invalidRequestsThreshold = options?.invalidRequestsThreshold || 5000
    this.globalBlockDurationMultiple = options?.globalBlockDurationMultiple || 1
    if (options?.delayOnInvalidThreshold !== false) {
      /**
       * Reset the invalid requests count every 10 minutes
       * since that is the duration specified by Discord.
       */
      setInterval(() => {
        this.invalidRequestsCount = 0
      }, 1000 * 60 * 10)
    }
  }

  /**
   * Increase the number of invalid requests. Invalid
   * requests have responses with status codes 401, 403,
   * 429.
   */
  private increaseInvalidRequestCount () {
    ++this.invalidRequestsCount
    if (this.invalidRequestsCount === this.invalidRequestsThreshold) {
      // Block all buckets from executing requests for 10 min
      this.emit('invalidRequestsThreshold', this.invalidRequestsCount)
    }
  }

  /**
   * Handle events from buckets
   */
  private registerBucketListener (bucket: Bucket) {
    bucket.on('recognizeURLBucket', this.recognizeURLBucket.bind(this))
    bucket.on('globalRateLimit', (apiRequest, durationMs) => {
      this.emit('globalRateLimit', apiRequest, durationMs * this.globalBlockDurationMultiple)
    })
    bucket.on('rateLimit', (apiRequest: APIRequest, durationMs: number) => {
      this.emit('rateLimit', apiRequest, durationMs)
    })
    bucket.on('invalidRequest', (apiRequest: APIRequest) => {
      this.increaseInvalidRequestCount()
      this.emit('invalidRequest', apiRequest, this.invalidRequestsCount)
    })
    bucket.on('cloudflareRateLimit', (apiRequest: APIRequest, durationMs) => {
      this.emit('cloudflareRateLimit', apiRequest, durationMs)
    })
  }

  /**
   * Create a permanent bucket for a route
   */
  private createBucket (route: string, bucketId: string) {
    const bucket = new Bucket(bucketId)
    this.buckets.set(bucketId, bucket)
    this.bucketsByUrl.set(route, bucket)
    this.registerBucketListener(bucket)
    return bucket
  }

  /**
   * Creates a temporary bucket for a route whose bucket is unknown
   */
  private createTemporaryBucket (route: string) {
    const bucket = new Bucket(route)
    this.temporaryBucketsByUrl.set(route, bucket)
    this.registerBucketListener(bucket)
    return bucket
  }

  /**
   * Removes a temporary bucket, and copies its rate limit settings
   * to the other bucket
   */
  private scheduleTemporaryBucketRemoval (route: string, newBucket: Bucket) {
    const tempBucket = this.temporaryBucketsByUrl.get(route)
    if (tempBucket) {
      // Wait for the bucket's queue to be empty for remaining requests
      tempBucket.once('finishedAll', () => {
        tempBucket.removeAllListeners()
        // Copy the bucket block over to the new bucket if it exists
        tempBucket.copyBlockTo(newBucket)
        this.temporaryBucketsByUrl.delete(route)
      })
    }
  }

  /**
   * Create a bucket for a new URL, or map a
   * url to its bucket if it exists for later reference
   */
  private recognizeURLBucket (route: string, bucketID: string) {
    if (!this.bucketExists(bucketID)) {
      const newBucket = this.createBucket(route, bucketID)
      // Remove the temporary bucket since it has a bucket ID assigned
      this.scheduleTemporaryBucketRemoval(route, newBucket)
    } else if (!this.bucketExistsForURL(route)) {
      const bucket = this.buckets.get(bucketID)
      this.bucketsByUrl.set(route, bucket as Bucket)
    }
  }

  /**
   * Block all buckets from running, or override buckets'
   * own timers if it's longer with the specified
   * duration
   */
  public blockBucketsByDuration (durationMs: number): void {
    this.buckets.forEach((bucket) => {
      const blockedUntil = bucket.blockedUntil
      if (!blockedUntil) {
        // Block the bucket if it's not blocked
        bucket.block(durationMs)
      } else {
        const now = new Date().getTime()
        const globalBlockUntil = new Date(now + durationMs)
        // Choose the longer duration for blocking
        if (globalBlockUntil > blockedUntil) {
          bucket.block(durationMs)
        }
      }
    })
  }

  /**
   * Check if a permanent bucket exists by ID
   */
  private bucketExists (bucketId: string) {
    return this.buckets.has(bucketId)
  }

  /**
   * Check if a permanent bucket exists for a route
   */
  private bucketExistsForURL (route: string) {
    return this.bucketsByUrl.has(route)
  }

  /**
   * Gets the bucket assigned for a URL.
   */
  private getBucketForUrl (url: string) {
    const bucket = this.bucketsByUrl.get(url)
    if (bucket) {
      // Return the temporary bucket if there are enqueued items to maintain order
      // The temporary bucket will eventually be removed once the queue is empty
      const temporaryBucket = this.temporaryBucketsByUrl.get(url)
      if (temporaryBucket && temporaryBucket.hasPendingRequests()) {
        return temporaryBucket
      }
      return bucket
    } else {
      const temporaryBucket = this.temporaryBucketsByUrl.get(url)
      if (!temporaryBucket) {
        return this.createTemporaryBucket(url)
      } else {
        return temporaryBucket
      }
    }
  }

  /**
   * Fetch a resource from Discord's API
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @returns node-fetch response
   */
  public async fetch (route: string, options: RequestInit): Promise<Response> {
    const { requestTimeout, requestTimeoutRetries } = this.userOptions
    const apiRequest = new APIRequest(route, options, {
      timeout: requestTimeout,
      maxAttempts: requestTimeoutRetries,
    })
    const url = apiRequest.route
    const bucket = this.getBucketForUrl(url)
    const result = await bucket.enqueue(apiRequest)
    return result
  }
}

export default RESTHandler
