import 'isomorphic-fetch'
import fetchRetry from 'fetch-retry';

const fetchWithRetry = fetchRetry(fetch);

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
   * If the fetch has been done or not. Value is true if fetch succeeded, false if it did not, or
   * undefined if fetch has not been executed
   */
  private fetchSuccess: boolean|undefined = undefined


  constructor (route: string, fetchOptions?: RequestInit) {
    this.route = route
    this.options = fetchOptions
    this.id = ++APIRequest.lastId
  }

  /**
   * Execute the request with a timeout
   */
  async execute (options?: {
    baseAttemptDelay?: number,
  }): Promise<Response> {
    try {
      const res = await fetchWithRetry(this.route, {
        ...this.options,
        retryDelay: function(attempt: number) {
          const baseAttemptDelay = options?.baseAttemptDelay || 1500
          
          return Math.pow(2, attempt) * baseAttemptDelay; // 1500, 3000, 6000, 12000
        },
        retryOn: function(attempt, error, response) {
          if (attempt >= 3) {
            return false;
          }

          const status = response?.status;

          if (error || !status) {
            return false
          }

          if (status === 422 || status >= 500) {
            return true;
          }

          return false
        }
      })

      this.fetchSuccess = true

      return res
    }
    catch (e) { 
      this.fetchSuccess = false
      throw e
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
