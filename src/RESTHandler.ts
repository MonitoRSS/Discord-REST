import Bucket from "./Bucket"
import APIRequest from "./APIRequest";
import { EventEmitter } from "events";
import { GLOBAL_BLOCK_TYPE } from "./constants/global-block-type";
import { RequestOptions } from "./types/RequestOptions";
import { FetchResponse } from "./types/FetchResponse";
import { LongRunningBucketRequest } from "./types/LongRunningBucketRequest";
import { LongRunningHandlerRequest } from "./types/LongRunningHandlerRequest";
import dayjs from "dayjs";
import { RateLimit } from 'async-sema'
import sleep from "./util/sleep";

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
   /**
    * Upon hitting the threshold for maximum invalid requests, or hitting a global rate limit via
    * Cloudflare, clear the queue so they don't get processed. This is useful for a distributed
    * queue where if the messages don't get acknowledged, they will go back into the queue and
    * execution won't be duplicated in this handler, or any other handler.
    */
   clearQueueAfterGlobalBlock?: boolean
}


declare interface RESTHandler {
  emit(event: 'globalBlock', type: GLOBAL_BLOCK_TYPE, blockedDurationMs: number): boolean
  emit(event: 'globalRestore', type: GLOBAL_BLOCK_TYPE): boolean
  emit(event: 'rateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'invalidRequest', apiRequest: APIRequest, countSoFar: number): boolean
  emit(event: 'idle'|'active'): boolean
  emit(event: 'LongRunningBucketRequest', details: LongRunningBucketRequest): boolean
  emit(event: 'longRunningHandlerRequest', details: LongRunningHandlerRequest): boolean
  emit(event: 'next', queueSize: number, pending: number): boolean
  /**
   * When a global block is in place. This can be from cloudflare rate limits, invalid requests
   * threshold, and global rate limits (from Discord).
   */
  on(event: 'globalBlock', listener: (type: GLOBAL_BLOCK_TYPE, blockedDurationMs: number) => void): this
  /**
   * When a global block has been expired
   */
  on(event: 'globalRestore', listener: (type: GLOBAL_BLOCK_TYPE) => void): this
  /**
   * When a bucket rate limit is encountered
   */
  on(event: 'rateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this;
  /**
   * When an invalid request that count towards a hard limit
   * is encountered.
   */
  on(event: 'invalidRequest', listener: (apiRequest: APIRequest, countSoFar: number) => void): this
  /**
   * When a bucket's processing time of a request has taken longer than 10 minutes
   */
  on(event: 'LongRunningBucketRequest', listener: (details: LongRunningBucketRequest) => void): this
  /**
   * When the RESTHandler's processing time of a request has taken longer than 10 minutes
   */
  on(event: 'LongRunningHandlerRequest', listener: (details: LongRunningHandlerRequest) => void): this
  /**
   * When another request has been completed.
   */
  on(event: 'next', listener: (queueSize: number, pending: number) => void): this
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
  private queueBlockTimer: NodeJS.Timer|null = null;
  private readonly userOptions: RESTHandlerOptions
  private globallyBlockedUntil?: Date
  private readonly rateLimit: ReturnType<typeof RateLimit>

  constructor (options?: RESTHandlerOptions) {
    super()
    this.userOptions = options || {}
    this.invalidRequestsThreshold = options?.invalidRequestsThreshold || 5000
    this.globalBlockDurationMultiple = options?.globalBlockDurationMultiple || 1

    this.rateLimit = RateLimit(this.userOptions.maxRequestsPerSecond || 30)

    if (process.env.NODE_ENV !== 'test') {
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
      this.blockGloballyByDuration({
        durationMs: 1000 * 60 * 10,
        blockType: GLOBAL_BLOCK_TYPE.INVALID_REQUEST
      })
    }
  }

  /**
   * Handle events from buckets
   */
  private registerBucketListener (bucket: Bucket) {
    bucket.on('recognizeURLBucket', this.recognizeURLBucket.bind(this))
    bucket.on('globalRateLimit', (apiRequest, durationMs) => {
      this.blockGloballyByDuration({
        durationMs,
        blockType: GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT
      })
    })
    bucket.on('rateLimit', (apiRequest: APIRequest, durationMs: number) => {
      this.emit('rateLimit', apiRequest, durationMs)
    })
    bucket.on('invalidRequest', (apiRequest: APIRequest) => {
      this.increaseInvalidRequestCount()
      this.emit('invalidRequest', apiRequest, this.invalidRequestsCount)
    })
    bucket.on('cloudflareRateLimit', (apiRequest: APIRequest, durationMs) => {
      this.blockGloballyByDuration({
        durationMs,
        blockType: GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT
      })
    })
    bucket.on('LongRunningBucketRequest', details => {
      this.emit('LongRunningBucketRequest', details)
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
   * Blocks all queued API requests and buckets for a duration
   * If there's already a timer, the previous timer is cleared
   * and is recreated
   */
     private blockGloballyByDuration ({
       durationMs,
       blockType
     }: {
       durationMs: number,
       blockType: GLOBAL_BLOCK_TYPE
     }) {
      const blockDuration = durationMs * this.globalBlockDurationMultiple
      this.blockBucketsByDuration(blockDuration)

      if (this.queueBlockTimer) {
        clearTimeout(this.queueBlockTimer)
      }
      
      // this.queue.pause()

      if (this.userOptions.clearQueueAfterGlobalBlock) {
        // this.queue.clear()
      }

      this.globallyBlockedUntil = dayjs().add(blockDuration, 'ms').toDate()
      this.emit('globalBlock', blockType, blockDuration)

      this.queueBlockTimer = setTimeout(() => {
        // this.queue.start()
        this.queueBlockTimer = null
        this.globallyBlockedUntil = undefined
        this.emit('globalRestore', blockType)
      }, blockDuration)
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
  public async fetch (route: string, options: RequestOptions): Promise<FetchResponse> {
    if (this.globallyBlockedUntil) {
      // wait until the global block is over
      const now = new Date().getTime()
      const timeLeft = this.globallyBlockedUntil.getTime() - now
      if (timeLeft > 0) {
        await sleep(timeLeft)
      }
    }

    const { requestTimeoutRetries } = this.userOptions
    const apiRequest = new APIRequest(route, {
      maxRetries: requestTimeoutRetries,
      ...options,
    })
    const url = apiRequest.route
    const bucket = this.getBucketForUrl(url)

    options.debugHistory?.push(`Retrieved bucket ${bucket.id}, adding to global queue. Current block ${(this.globallyBlockedUntil?.getTime() || 0) / 1000}`)
    await this.rateLimit()
    options.debugHistory?.push(`p-queue job started, enqueuing into bucket ${bucket.id}`)

    return bucket.enqueue(apiRequest, {
      debugHistory: options.debugHistory
    })
  }
}

export default RESTHandler
