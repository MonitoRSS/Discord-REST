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
   * Maximum number of failed attempts before rejecting
   */
  static readonly maxAttempts = 3
  /**
   * The time until this request will timeout
   */
  static readonly timeout = 10000

  constructor (route: string, options?: RequestInit) {
    this.route = route
    this.options = options
    this.id = ++APIRequest.lastId
  }

  /**
   * Execute the request with a timeout
   */
  async execute (): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), APIRequest.timeout)
    try {
      const res = await fetch(this.route, {
        ...this.options,
        signal: controller.signal
      })
      return res
    } catch (err) {
      if (err.type === 'aborted' && this.attempted++ < APIRequest.maxAttempts) {
        // If the request timed out, retry it
        return this.execute()
      } else {
        throw err
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  toString (): string {
    return `${this.route} (#${this.id})`
  }
}

export default APIRequest
