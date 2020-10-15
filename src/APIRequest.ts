import fetch, { RequestInit, Response } from 'node-fetch'
import AbortController from 'abort-controller'

class APIRequest {
  /**
   * Full API request URL
   */
  route: string
  /**
   * node-fetch options
   */
  options?: RequestInit
  /**
   * ID used to track the completion of every request
   */
  id: number
  /**
   * Auto-incrementing ID for every request
   */
  static lastId = 0
  /**
   * Number failed attempts of this request
   */
  attempted = 0
  /**
   * If the fetch has been done or not. Value is true if fetch succeeded, false if it did not, or
   * undefined if fetch has not been executed
   */
  fetchSuccess: boolean|undefined = undefined
  /**
   * The time until this request will timeout
   */
  readonly timeout: number
  /**
   * Maximum number of failed attempts before rejecting
   */
  readonly maxAttempts: number


  constructor (route: string, options?: RequestInit, timeout = 10000, maxAttempts = 3) {
    this.route = route
    this.options = options
    this.id = ++APIRequest.lastId
    this.timeout = timeout
    this.maxAttempts = maxAttempts
  }

  /**
   * Execute the request with a timeout
   */
  async execute (): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeout)
    try {
      const res = await fetch(this.route, {
        ...this.options,
        signal: controller.signal
      })
      this.fetchSuccess = true
      return res
    } catch (err) {
      if (err.type === 'aborted' && this.attempted++ < this.maxAttempts) {
        // If the request timed out, retry it
        return this.execute()
      } else {
        this.fetchSuccess = false
        throw err
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Returns the string representation for debug logging
   */
  toString (): string {
    return `${this.route} (#${this.id})`
  }
}

export default APIRequest
