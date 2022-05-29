import { request } from 'undici'
import { FetchResponse } from './types/FetchResponse';
import retry from 'retry'

type RequestOptions = {
  /**
   * Maximum number of retries before rejecting. By default, 10.
   */
  maxRetries?: number
  method?: 'POST'|'GET'|'PATCH'|'PUT'
  body?: string
  headers?: Record<string, string>
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


  constructor (route: string, private readonly requestOptions?: RequestOptions) {
    this.route = route
    this.id = ++APIRequest.lastId
  }

  /**
   * Execute the request with a timeout
   */
  async execute (options?: {
    baseAttemptDelay?: number,
  }): Promise<FetchResponse> {
    const maxRetries = this.requestOptions?.maxRetries ?? 10
    const operation = retry.operation({
      minTimeout: options?.baseAttemptDelay,
      retries: maxRetries,
    });

    return new Promise<FetchResponse>((resolve, reject) => {
      operation.attempt(async () => {
        try {
          const res = await this.sendFetch()

          let operationError: Error | undefined = undefined;
          if (res.status === 422 || res.status >= 500) {
            operationError = new Error(`Bad status code (${res.status})`)
          }

          if (!operation.retry(operationError)) {
            return resolve(res)
          }

        } catch (err) {
          if (!operation.retry(err as Error)) {
            reject(err)
          }
        }
      })
    })
  }

  async sendFetch(): Promise<FetchResponse> {
    try {
      const res = await request(this.route, {
        method: this.requestOptions?.method || 'GET',
        body: this.requestOptions?.body,
        headers: this.requestOptions?.headers,
        bodyTimeout: 1000 * 60,
        headersTimeout: 1000 * 60,
        maxRedirections: 10,
      })

      // if (res.statusCode === 422) {
        // throw new Error(`Rate limited (422 status code)`)
      // }

      // if (res.statusCode >= 500) {
      //   throw new Error(`Discord internal error (${res.statusCode})`)
      // }

      this.fetchSuccess = true

      return {
        json: async () => res.body.json(),
        text: async () => res.body.text(),
        headers: res.headers,
        status: res.statusCode
      }
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
