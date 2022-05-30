export type RequestOptions = {
  /**
   * Maximum number of retries before rejecting
   */
  maxRetries?: number
  method?: 'POST'|'GET'|'PATCH'|'PUT'
  body?: string
  headers?: Record<string, string>
  debugHistory?: string[]
}
