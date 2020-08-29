import Bucket from "./Bucket"
import { RequestInit, Response } from "node-fetch";
import APIRequest from "./APIRequest";
import { EventEmitter } from "events";

declare interface RESTHandler {
  emit(event: 'rateLimit', apiRequest: APIRequest): boolean
  emit(event: 'globalRateLimit'): boolean
  on(event: 'rateLimit', listener: (apiRequest: APIRequest) => void): this;
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
  temporaryBucketsByUrl: Map<string, Bucket>
  /**
   * Buckets mapped by their IDs, where the IDs are the
   * ones returned by Discord.
   */
  buckets: Map<string, Bucket>
  /**
   * Buckets mapped by the route URLs. These buckets are
   * considered the "true" buckets for their specified
   * routes since their IDs were returned by Discord.
   * 
   * This is a convenience map that is made alongside
   * the "buckets" instance variable whenever subsequent
   * requests are made.
   */
  bucketsByUrl: Map<string, Bucket>

  constructor () {
    super()
    this.temporaryBucketsByUrl = new Map()
    this.buckets = new Map()
    this.bucketsByUrl = new Map()
  }

  /**
   * Handle events from buckets
   */
  private registerBucketListener (bucket: Bucket) {
    bucket.on('recognizeURLBucket', this.recognizeURLBucket.bind(this))
    bucket.on('globalRateLimit', (number) => {
      this.emit('globalRateLimit')
      this.blockBucketsByDuration(number)
    })
    bucket.on('rateLimit', (apiRequest: APIRequest) => this.emit('rateLimit', apiRequest))
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
  private blockBucketsByDuration (durationMs: number) {
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
    const apiRequest = new APIRequest(route, options)
    const url = apiRequest.route
    const bucket = this.getBucketForUrl(url)
    return bucket.enqueue(apiRequest)
  }
}

export default RESTHandler
