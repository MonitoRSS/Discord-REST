import { REST, RESTEvents, DiscordAPIError, HTTPError } from '@discordjs/rest'
import type { RequestMethod, RouteLike } from '@discordjs/rest'
import { URL } from 'url'
import { EventEmitter } from 'events'
import APIRequest from './APIRequest'
import { GLOBAL_BLOCK_TYPE } from './constants/global-block-type'
import { RequestOptions } from './types/RequestOptions'
import { FetchResponse } from './types/FetchResponse'
import { LongRunningBucketRequest } from './types/LongRunningBucketRequest'
import { LongRunningHandlerRequest } from './types/LongRunningHandlerRequest'

const DEFAULT_API = 'https://discord.com/api'
const DEFAULT_VERSION = '10'
const CLOUDFLARE_BLOCK_DURATION_MS = 1000 * 60 * 60 * 3
const INVALID_REQUEST_BLOCK_DURATION_MS = 1000 * 60 * 10
const LONG_RUNNING_REQUEST_DURATION_MS = 1000 * 60 * 10

export type RESTHandlerOptions = {
  /**
   * Maximum number of invalid requests allowed within 10
   * minutes before delaying all further requests by
   * 10 minutes.
   *
   * Default is half of the hard limit, where the hard limit
   * is 10,000
   */
  invalidRequestsThreshold?: number,
  /**
   * Whether to delay all requests by 10 minutes when the
   * invalid requests threshold is reached
   */
  delayOnInvalidThreshold?: boolean,
  /**
   * Milliseconds to wait for an API request before automatically
   * timing it out
   */
  requestTimeout?: number,
  /**
   * Number of request retries on API request timeouts
   */
  requestTimeoutRetries?: number,
  /**
   * Multiple of the duration to block the queue by when a global
   * limit is hit. It could be safer to block longer than what Discord
   * suggests for safety.
   *
   * Default is 1
   */
  globalBlockDurationMultiple?: number
  /**
   * Maximum number of requests to execute per second.
   *
   * Default is 35
   */
  maxRequestsPerSecond?: number
  /**
   * Name of the queue. Retained for backwards compatibility; requests
   * are queued in memory by @discordjs/rest.
   */
  queueName?: string
  /**
   * Retained for backwards compatibility. @discordjs/rest owns request
   * queuing, so these options are not used.
   */
  pqueueOptions?: Record<string, any>
  /**
   * Retained for backwards compatibility. @discordjs/rest owns request
   * queuing, so there is no local queue to clear.
   */
  clearQueueAfterGlobalBlock?: boolean
}

declare interface RESTHandler {
  emit(event: 'globalBlock', type: GLOBAL_BLOCK_TYPE, blockedDurationMs: number, debugDetails?: Record<string, any>): boolean
  emit(event: 'globalRestore', type: GLOBAL_BLOCK_TYPE): boolean
  emit(event: 'rateLimit', apiRequest: APIRequest, blockedDurationMs: number): boolean
  emit(event: 'invalidRequest', apiRequest: APIRequest, countSoFar: number): boolean
  emit(event: 'idle'|'active'): boolean
  emit(event: 'LongRunningBucketRequest', details: LongRunningBucketRequest): boolean
  emit(event: 'longRunningHandlerRequest', details: LongRunningHandlerRequest): boolean
  emit(event: 'next', queueSize: number, pending: number): boolean
  /**
   * When a global block is in place. This can be from cloudflare rate limits, invalid requests
   * threshold, and global rate limits (from Discord).
   */
  on(event: 'globalBlock', listener: (type: GLOBAL_BLOCK_TYPE, blockedDurationMs: number, debugDetails?: Record<string, any>) => void): this
  /**
   * When a global block has been expired
   */
  on(event: 'globalRestore', listener: (type: GLOBAL_BLOCK_TYPE) => void): this
  /**
   * When a bucket rate limit is encountered
   */
  on(event: 'rateLimit', listener: (apiRequest: APIRequest, blockedDurationMs: number) => void): this;
  /**
   * When an invalid request that count towards a hard limit
   * is encountered.
   */
  on(event: 'invalidRequest', listener: (apiRequest: APIRequest, countSoFar: number) => void): this
  on(event: 'idle'|'active', listener: () => void): this
  /**
   * When a bucket's processing time of a request has taken longer than 10 minutes
   */
  on(event: 'LongRunningBucketRequest', listener: (details: LongRunningBucketRequest) => void): this
  /**
   * When the RESTHandler's processing time of a request has taken longer than 10 minutes
   */
  on(event: 'longRunningHandlerRequest', listener: (details: LongRunningHandlerRequest) => void): this
  /**
   * When another request has been completed.
   */
  on(event: 'next', listener: (queueSize: number, pending: number) => void): this
}

interface ParsedRoute {
  api: string
  version: string
  fullRoute: RouteLike
  versioned: boolean
}

/**
 * Split a full Discord-like URL into the pieces @discordjs/rest needs.
 *
 * The listener is given full URLs (which may point at a fake Discord
 * server in tests), while @discordjs/rest expects an API base plus a
 * versioned route.
 */
function parseRoute (route: string): ParsedRoute {
  if (!/^https?:\/\//i.test(route)) {
    return {
      api: DEFAULT_API,
      version: DEFAULT_VERSION,
      fullRoute: (route.startsWith('/') ? route : `/${route}`) as RouteLike,
      versioned: true,
    }
  }

  const url = new URL(route)
  const match = url.pathname.match(/^\/api(?:\/v(\d+))?(\/.*)?$/)

  if (!match) {
    return {
      api: url.origin,
      version: DEFAULT_VERSION,
      fullRoute: `${url.pathname}${url.search}` as RouteLike,
      versioned: false,
    }
  }

  return {
    api: `${url.origin}/api`,
    version: match[1] || DEFAULT_VERSION,
    fullRoute: `${match[2] || '/'}${url.search}` as RouteLike,
    versioned: true,
  }
}

function headersToObject (headers: any): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value: string, key: string) => {
    result[key] = value
  })
  return result
}

/**
 * Discord sends rate limit durations as seconds. Returns -1 when the
 * header is missing or malformed, which is how Cloudflare bans are
 * detected on a 429 response.
 */
function parseSecondsToMs (value: string | null): number {
  if (value === null) {
    return -1
  }
  const parsed = Number(value)
  if (isNaN(parsed)) {
    return -1
  }
  return parsed * 1000
}

/**
 * The entry point for all requests
 */
class RESTHandler extends EventEmitter {
  /**
   * @discordjs/rest instances keyed by API base and version. Discord
   * rate limits are scoped per API host, so each host gets its own
   * rate limit state.
   */
  private readonly rests: Map<string, REST> = new Map()
  private readonly restOptions: Record<string, any>
  /**
   * Number of invalid requests made within 10 minutes
   */
  private invalidRequestsCount = 0
  /**
   * Maximum number of invalid requests allowed within 10
   * minutes before delaying all further requests by
   * 10 minutes.
   */
  private readonly invalidRequestsThreshold: number
  /**
   * Multiply the global block duration by this number whenever
   * a global rate limit is hit
   */
  private readonly globalBlockDurationMultiple: number
  /**
   * When set, all requests wait until this date before being handed
   * to @discordjs/rest. This mirrors the previous handler's queue-wide
   * pause during a global block.
   */
  private globallyBlockedUntil?: Date
  private queueBlockTimer: NodeJS.Timeout | null = null
  private unblockPromise?: Promise<void>
  private unblockResolve?: () => void
  /**
   * Number of requests currently being processed by this handler.
   */
  private inFlight = 0

  constructor (options?: RESTHandlerOptions) {
    super()
    this.invalidRequestsThreshold = options?.invalidRequestsThreshold || 5000
    this.globalBlockDurationMultiple = options?.globalBlockDurationMultiple || 1
    this.restOptions = {
      timeout: options?.requestTimeout || 1000 * 60,
      retries: options?.requestTimeoutRetries ?? 3,
      globalRequestsPerSecond: options?.maxRequestsPerSecond || 35,
      /**
       * A 429 without a Retry-After header is how Cloudflare bans are
       * surfaced. Throwing instead of sleeping(0) prevents a tight retry
       * loop until the ban is handled by the consumer.
       */
      rejectOnRateLimit: (data: any) => data.retryAfter <= 0,
    }

    this.getRest(DEFAULT_API, DEFAULT_VERSION)

    if (process.env.NODE_ENV !== 'test') {
      if (options?.delayOnInvalidThreshold !== false) {
        /**
         * Reset the invalid requests count every 10 minutes
         * since that is the duration specified by Discord.
         */
        setInterval(() => {
          this.invalidRequestsCount = 0
        }, INVALID_REQUEST_BLOCK_DURATION_MS).unref()
      }
    }
  }

  /**
   * Get or create the @discordjs/rest instance for an API host.
   */
  private getRest (api: string, version: string): REST {
    const key = `${api}|v${version}`
    let rest = this.rests.get(key)

    if (!rest) {
      rest = new REST({
        ...this.restOptions,
        api,
        version,
      })
      this.setupEventListeners(rest)
      this.rests.set(key, rest)

      if (this.globallyBlockedUntil) {
        rest.globalRemaining = 0
        rest.globalReset = this.globallyBlockedUntil.getTime()
      }
    }

    return rest
  }

  /**
   * Map @discordjs/rest's raw responses to this handler's events.
   *
   * @discordjs/rest only emits its own `rateLimited` event for requests
   * that wait on an already-known limit, not for the initial 429. The
   * response event fires for every attempt, so it is the reliable place
   * to observe rate limits and invalid requests.
   */
  private setupEventListeners (rest: REST): void {
    rest.on(RESTEvents.Response, (req: any, response: any) => {
      const apiRequest = new APIRequest(req.path)
      const status = response.status

      if (status === 429) {
        this.handleRateLimitedResponse(apiRequest, response.headers)
        this.increaseInvalidRequestCount(apiRequest)
      } else if (status === 401 || status === 403) {
        this.increaseInvalidRequestCount(apiRequest)
      }
    })
  }

  private handleRateLimitedResponse (apiRequest: APIRequest, headers: any): void {
    const isGlobal = headers.has('x-ratelimit-global')
    const hasBucket = headers.has('x-ratelimit-bucket')
    const retryAfterMs = parseSecondsToMs(headers.get('retry-after'))
    const resetAfterMs = parseSecondsToMs(headers.get('x-ratelimit-reset-after'))

    let blockedDurationMs = -1
    if (isGlobal) {
      blockedDurationMs = retryAfterMs
    } else if (hasBucket) {
      blockedDurationMs = resetAfterMs
    }

    if (blockedDurationMs === -1) {
      // Typically when the IP has been blocked by Cloudflare. Wait 3 hours if this happens.
      this.blockGloballyByDuration({
        durationMs: CLOUDFLARE_BLOCK_DURATION_MS,
        blockType: GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT,
        debugDetails: {
          headers: headersToObject(headers),
        },
      })
    } else if (isGlobal) {
      this.blockGloballyByDuration({
        durationMs: blockedDurationMs,
        blockType: GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT,
      })
    } else {
      this.emit('rateLimit', apiRequest, blockedDurationMs)
    }
  }

  /**
   * Increase the number of invalid requests. Invalid
   * requests have responses with status codes 401, 403,
   * 429.
   */
  private increaseInvalidRequestCount (apiRequest: APIRequest): void {
    ++this.invalidRequestsCount
    this.emit('invalidRequest', apiRequest, this.invalidRequestsCount)

    if (this.invalidRequestsCount === this.invalidRequestsThreshold) {
      // Block all requests from executing for 10 min
      this.blockGloballyByDuration({
        durationMs: INVALID_REQUEST_BLOCK_DURATION_MS,
        blockType: GLOBAL_BLOCK_TYPE.INVALID_REQUEST,
      })
    }
  }

  /**
   * Blocks all queued API requests for a duration.
   * If there's already a timer, the previous timer is cleared
   * and is recreated.
   */
  private blockGloballyByDuration ({
    durationMs,
    blockType,
    debugDetails,
  }: {
    durationMs: number,
    blockType: GLOBAL_BLOCK_TYPE,
    debugDetails?: Record<string, any>
  }): void {
    const blockDuration = durationMs * this.globalBlockDurationMultiple
    this.blockBucketsByDuration(blockDuration)

    if (this.queueBlockTimer) {
      clearTimeout(this.queueBlockTimer)
    }

    /**
     * Release anyone waiting on the previous block so they re-check
     * the new block duration.
     */
    if (this.unblockResolve) {
      this.unblockResolve()
    }

    this.globallyBlockedUntil = new Date(Date.now() + blockDuration)
    this.unblockPromise = new Promise((resolve) => {
      this.unblockResolve = resolve
    })

    this.emit('globalBlock', blockType, blockDuration, debugDetails)

    this.queueBlockTimer = setTimeout(() => {
      this.queueBlockTimer = null
      this.globallyBlockedUntil = undefined
      const resolve = this.unblockResolve
      this.unblockPromise = undefined
      this.unblockResolve = undefined
      resolve?.()
      this.emit('globalRestore', blockType)
    }, blockDuration)
  }

  /**
   * Block @discordjs/rest's global rate limit state for a duration.
   */
  public blockBucketsByDuration (durationMs: number): void {
    const blockedUntil = Date.now() + durationMs
    this.rests.forEach((rest) => {
      rest.globalRemaining = 0
      rest.globalReset = Math.max(rest.globalReset || 0, blockedUntil)
    })
  }

  /**
   * Wait for an active global block to expire before executing.
   */
  private async waitForGlobalBlock (): Promise<void> {
    while (this.globallyBlockedUntil && this.globallyBlockedUntil.getTime() > Date.now()) {
      const promise = this.unblockPromise
      if (!promise) {
        return
      }
      await promise
    }
  }

  /**
   * Fetch a resource from Discord's API
   *
   * @param route The full HTTP route string
   * @param options Request options
   * @returns Fetch response
   */
  public async fetch (route: string, options: RequestOptions = {}): Promise<FetchResponse> {
    const parsed = parseRoute(route)
    const apiRequest = new APIRequest(route, options)
    const rest = this.getRest(parsed.api, parsed.version)
    const method = (options.method || 'GET').toUpperCase() as RequestMethod

    // @discordjs/rest serializes object bodies as JSON. Requests from the
    // producer carry a JSON string, so parse it back into an object. If it
    // is not JSON, send the raw string through unchanged.
    let body: any = options.body
    let passThroughBody: boolean | undefined
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        passThroughBody = true
      }
    }

    let requestStarted = false

    const longRunningTimeout = setTimeout(() => {
      this.emit('LongRunningBucketRequest', {
        bucketBlockedUntil: this.globallyBlockedUntil || null,
        bucketId: parsed.fullRoute,
        bucketQueueLength: 0,
        executedApiRequest: requestStarted,
      })
      this.emit('longRunningHandlerRequest', {
        executedApiRequest: requestStarted,
        globalBlockedUntil: this.globallyBlockedUntil || null,
        globalQueueLength: this.inFlight,
      })
    }, LONG_RUNNING_REQUEST_DURATION_MS)

    const longRunningInterval = setInterval(() => {
      options.debugHistory?.push(`Current in-flight requests: ${this.inFlight}. Current block ${(this.globallyBlockedUntil?.getTime() || 0) / 1000}. Time: ${new Date().toISOString()}. Route: ${apiRequest.toString()}`)
    }, 1000 * 60)

    this.inFlight++
    if (this.inFlight === 1) {
      this.emit('active')
    }

    try {
      await this.waitForGlobalBlock()

      requestStarted = true
      const response = await rest.queueRequest({
        fullRoute: parsed.fullRoute,
        method,
        body,
        passThroughBody,
        headers: options.headers,
        auth: false,
        versioned: parsed.versioned,
      })

      return await this.wrapResponse(response)
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as any
      if (error instanceof DiscordAPIError || error?.name === 'DiscordAPIError') {
        // Preserve the previous behavior where callers receive the raw
        // response for non-2xx status codes instead of an exception.
        return this.createSyntheticResponse(error.status, error.rawError)
      }
      if (error instanceof HTTPError || error?.name === 'HTTPError') {
        return this.createSyntheticResponse(error.status, {
          message: error.statusText || error.message,
        })
      }
      throw err
    } finally {
      clearTimeout(longRunningTimeout)
      clearInterval(longRunningInterval)
      this.inFlight--
      this.emit('next', 0, this.inFlight)
      if (this.inFlight === 0) {
        this.emit('idle')
      }
    }
  }

  private async wrapResponse (response: any): Promise<FetchResponse> {
    const body = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value: string, key: string) => {
      headers[key] = value
    })

    return {
      status: response.status,
      headers,
      json: async () => JSON.parse(body),
      text: async () => body,
    }
  }

  private createSyntheticResponse (status: number, body: unknown): FetchResponse {
    /**
     * @discordjs/rest parses non-JSON error bodies as an ArrayBuffer.
     * Decode it so callers still receive the raw response text.
     */
    if (body instanceof ArrayBuffer) {
      const text = new TextDecoder().decode(body)
      return {
        status,
        headers: {
          'content-type': 'text/plain',
        },
        json: async () => JSON.parse(text),
        text: async () => text,
      }
    }

    const serialized = JSON.stringify(body)
    const text = serialized === undefined ? '' : serialized

    return {
      status,
      headers: {
        'content-type': 'application/json',
      },
      json: async () => body,
      text: async () => text,
    }
  }
}

export default RESTHandler
