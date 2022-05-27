export enum GlobalBlockType {
  /**
   * When the number of invalid requests threshold has been reached,
   * all requests are delayed by 10 minutes
   */
  INVALID_REQUEST = 'invalidRequest',
  /**
   * When a global rate limit is encountered
   */
  GLOBAL_RATE_LIMIT = 'globalRateLimit',
  /**
   * When the IP has likely been banned for several hours after exceeding the maximum rate
   * limits allowed within a duration.
   */
  CLOUDFLARE_RATE_LIMIT = 'cloudflareRateLimit'
}
