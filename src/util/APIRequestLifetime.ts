import { EventEmitter } from "events";
import APIRequest from "../APIRequest";
import Bucket from "../Bucket";

declare interface APIRequestLifetime {
  emit(event: 'longLived'): boolean
  on(event: 'longLived', listener: () => void): this
}

class APIRequestLifetime extends EventEmitter {
  /**
   * The APIRequest we're tracking
   */
  private request: APIRequest
  /**
   * The bucket the API request belongs to
   */
  private bucket: Bucket
  /**
   * Timer that will emit longLived on end, indicating this request has lived for too long
   */
  private longLivedTimer: NodeJS.Timer

  constructor (apiRequest: APIRequest, apiRequestBucket: Bucket) {
    super()
    this.request = apiRequest
    this.bucket = apiRequestBucket
    /**
     * Emit a longLived event after 30 minutes for the RESTHandler to propagate to the user
     */
    this.longLivedTimer = setTimeout(() => {
      this.emit('longLived')
    }, 1000 * 60 * 30)
  }

  /**
   * The date when the bucket for this API request will be unblocked. Returns undefined
   * if its bucket is not blocked.
   */
  public getBucketUnblockTime (): Date|undefined {
    return this.bucket.blockedUntil
  }

  /**
   * The success state of the actual API request. If undefined, then it has not done the actual
   * request yet. Otherwise, the boolean value indicates its fetch success state.
   */
  public hasFinishedRequest (): boolean|undefined {
    return this.request.fetchSuccess
  }

  /**
   * Stops tracking this lifetime. Prevents the RESTHandler from emitting a longLived event, if
   * it didn't emit it already.
   */
  end (): void {
    clearTimeout(this.longLivedTimer)
    this.removeAllListeners()
  }
}

export default APIRequestLifetime
