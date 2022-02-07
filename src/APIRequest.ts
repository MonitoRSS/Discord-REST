import fetch, { RequestInit, Response } from 'node-fetch'
import AbortController from 'abort-controller'

type RequestOptions = {
  /**
   * The time until this request will timeout
   */
  timeout?: number,
  /**
   * Maximum number of failed attempts before rejecting
   */
  maxAttempts?: number
}

class APIRequest {
  /**
   * Full API request URL
   */
  readonly route: string
  /**
   * node-fetch options
   */
  readonly options?: RequestInit
  /**
   * ID used to track the completion of every request
   */
  readonly id: number
  /**
   * Auto-incrementing ID for every request
   */
  static lastId = 0
  /**
   * Number failed attempts of this request
   */
  private attempted = 0
  /**
   * If the fetch has been done or not. Value is true if fetch succeeded, false if it did not, or
   * undefined if fetch has not been executed
   */
  private fetchSuccess: boolean|undefined = undefined
  /**
   * The time until this request will timeout. Default is 10000.
   */
  private readonly timeout: number
  /**
   * Maximum number of failed attempts before rejecting. Default is 3.
   */
  private readonly maxAttempts: number


  constructor (route: string, fetchOptions?: RequestInit, requestOptions?: RequestOptions) {
    this.route = route
    this.options = fetchOptions
    this.id = ++APIRequest.lastId
    this.timeout = requestOptions?.timeout || 10000
    this.maxAttempts = requestOptions?.maxAttempts || 3
  }

  /**
   * Execute the request with a timeout
   */
  async execute (): Promise<Response> {
    // const timeout = setTimeout(() => controller.abort(), this.timeout)
    try {
      const res = await fetch(this.route, {
        ...this.options,
      })
      this.fetchSuccess = true
      return res
    } catch (err) {
      this.fetchSuccess = false
      throw err
    }
  }

  hasSucceeded(): boolean|undefined {
    return this.fetchSuccess
  }

  /**
   * Returns the string representation for debug logging
   */
  toString (): string {
    return `${this.route} (#${this.id})`
  }
}

export default APIRequest
