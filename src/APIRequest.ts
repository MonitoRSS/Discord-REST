class APIRequest {
  /**
   * Full API request URL
   */
  readonly route: string
  /**
   * Request options
   */
  readonly options?: Record<string, any>
  /**
   * ID used to track the completion of every request
   */
  readonly id: number
  /**
   * Auto-incrementing ID for every request
   */
  static lastId = 0

  constructor (route: string, options?: Record<string, any>) {
    this.route = route
    this.options = options
    this.id = ++APIRequest.lastId
  }

  /**
   * Returns the string representation for debug logging
   */
  toString (): string {
    return `${this.route} (#${this.id})`
  }
}

export default APIRequest
