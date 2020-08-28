import Bucket from "./Bucket"
import { RequestInit, Response } from "node-fetch";
import APIRequest from "./APIRequest";
import { EventEmitter } from "events";

class RESTHandler extends EventEmitter {
  temporaryBucketsByUrl: Map<string, Bucket>
  buckets: Map<string, Bucket>
  bucketsByUrl: Map<string, Bucket>

  constructor () {
    super()
    /**
     * Routes that don't yet have a bucket ID assigned
     * @type {Map<string, import('./Bucket.js')>}
     */
    this.temporaryBucketsByUrl = new Map()
    /**
     * Buckets by ID
     * @type {Map<string, import('./Bucket.js')>}
     */
    this.buckets = new Map()
    /**
     * Buckets by URL
     * @type {Map<string, import('./Bucket.js')>}
     */
    this.bucketsByUrl = new Map()
  }

  /**
   * Handle events from buckets
   */
  private registerBucketListener (bucket: Bucket) {
    bucket.on('recognizeURLBucket', this.recognizeURLBucket.bind(this))
    bucket.on('globalLimit', this.blockBucketsByDuration.bind(this))
    bucket.on('429', (apiRequest: APIRequest) => this.emit('429', apiRequest))
  }

  /**
   * Create a permanent bucket for a route
   */
  private createBucket (route: string, bucketId: string) {
    const bucket = new Bucket(this, bucketId)
    this.buckets.set(bucketId, bucket)
    this.bucketsByUrl.set(route, bucket)
    this.registerBucketListener(bucket)
    return bucket
  }

  /**
   * Creates a temporary bucket for a route whose bucket is unknown
   */
  private createTemporaryBucket (route: string) {
    const bucket = new Bucket(this, route)
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
   * Block all buckets from running, or override
   * buckets' own timers if it's longer for a duration
   */
  private blockBucketsByDuration (durationMs: number) {
    this.buckets.forEach((bucket) => {
      const blockedUntil = bucket.blockedUntil
      if (!blockedUntil) {
        bucket.block(durationMs)
      } else {
        const now = new Date().getTime()
        const globalBlockUntil = new Date(now + durationMs)
        // Choose the longer duration
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
      if (temporaryBucket && temporaryBucket.queue.length > 0) {
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

  public async fetch (route: string, options: RequestInit): Promise<Response> {
    const apiRequest = new APIRequest(route, options)
    const url = apiRequest.route
    const bucket = this.getBucketForUrl(url)
    return bucket.enqueue(apiRequest)
  }
}

export default RESTHandler
