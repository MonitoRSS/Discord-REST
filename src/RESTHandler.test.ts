import RESTHandler from './RESTHandler'
import { GLOBAL_BLOCK_TYPE } from './constants/global-block-type'

jest.mock('@discordjs/rest', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter: MockEventEmitter } = require('events')

  class MockREST extends MockEventEmitter {
    options: any
    globalRemaining = 50
    globalReset = -1
    queueRequest = jest.fn()

    constructor (options?: any) {
      super()
      this.options = options || {}
    }
  }

  class DiscordAPIError extends Error {
    rawError: any
    code: any
    status: number
    method: string
    url: string
    requestBody: any

    constructor (rawError: any, code: any, status: number, method: string, url: string, bodyData: any) {
      super('DiscordAPIError')
      this.name = 'DiscordAPIError'
      this.rawError = rawError
      this.code = code
      this.status = status
      this.method = method
      this.url = url
      this.requestBody = bodyData
    }
  }

  class HTTPError extends Error {
    status: number
    statusText: string
    method: string
    url: string
    requestBody: any

    constructor (status: number, statusText: string, method: string, url: string, bodyData: any) {
      super(statusText)
      this.name = 'HTTPError'
      this.status = status
      this.statusText = statusText
      this.method = method
      this.url = url
      this.requestBody = bodyData
    }
  }

  class RateLimitError extends Error {
    data: any

    constructor (data: any) {
      super('Rate limit exceeded')
      this.name = 'RateLimitError'
      this.data = data
    }
  }

  return {
    REST: MockREST,
    RESTEvents: {
      RateLimited: 'rateLimited',
      Response: 'response',
    },
    DiscordAPIError,
    HTTPError,
    RateLimitError,
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const discordRest = require('@discordjs/rest')

jest.useFakeTimers({ doNotFake: ['performance'] })

async function flushPromises (times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function getMockRest (handler: RESTHandler, api = 'https://discord.com/api', version = '10'): any {
  return (handler as any).rests.get(`${api}|v${version}`)
}

function createMockHeaders (headers: Record<string, string> = {}) {
  const normalized = new Map<string, string>()
  Object.entries(headers).forEach(([key, value]) => {
    normalized.set(key.toLowerCase(), value)
  })

  return {
    get: (name: string) => normalized.get(name.toLowerCase()) ?? null,
    has: (name: string) => normalized.has(name.toLowerCase()),
    forEach: (callback: (value: string, key: string) => void) => {
      normalized.forEach((value, key) => callback(value, key))
    },
  }
}

function createMockResponse (
  body: string,
  status = 200,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) {
  return {
    status,
    headers: createMockHeaders(headers),
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

describe('RESTHandler', () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
  })

  describe('constructor', () => {
    it('creates a REST instance with mapped options', () => {
      const handler = new RESTHandler({
        requestTimeout: 5000,
        requestTimeoutRetries: 2,
        maxRequestsPerSecond: 30,
      })
      const rest = getMockRest(handler)

      expect(rest.options).toMatchObject({
        timeout: 5000,
        retries: 2,
        globalRequestsPerSecond: 30,
        api: 'https://discord.com/api',
        version: '10',
      })
      expect(typeof rest.options.rejectOnRateLimit).toEqual('function')
    })

    it('uses defaults when no options provided', () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)

      expect(rest.options).toMatchObject({
        timeout: 1000 * 60,
        retries: 3,
        globalRequestsPerSecond: 35,
      })
    })
  })

  describe('fetch', () => {
    it('extracts the route from a full URL with a version', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{"ok":true}'))

      await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          fullRoute: '/channels/123',
          method: 'GET',
          auth: false,
          versioned: true,
        })
      )
    })

    it('extracts the route from a full URL without a version', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('https://discord.com/api/channels/456', { method: 'POST' })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          fullRoute: '/channels/456',
          method: 'POST',
        })
      )
    })

    it('keeps the query string', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('https://discord.com/api/v10/channels/123/messages?wait=true', { method: 'POST' })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          fullRoute: '/channels/123/messages?wait=true',
        })
      )
    })

    it('uses a separate REST instance for a non-Discord host', async () => {
      const handler = new RESTHandler()
      const rest = (handler as any).getRest('http://127.0.0.1:9999/api', '10')
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('http://127.0.0.1:9999/api/v10/channels/123/messages', { method: 'POST' })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          fullRoute: '/channels/123/messages',
          versioned: true,
        })
      )
    })

    it('parses a JSON string body into an object', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('https://discord.com/api/v10/channels/123/messages', {
        method: 'POST',
        body: JSON.stringify({ content: 'hello' }),
      })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { content: 'hello' },
        })
      )
    })

    it('passes a non-JSON string body through unchanged', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('https://discord.com/api/v10/channels/123/messages', {
        method: 'POST',
        body: 'not-json',
      })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'not-json',
          passThroughBody: true,
        })
      )
    })

    it('forwards the Authorization header without letting the REST client override it', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('https://discord.com/api/v10/channels/123', {
        method: 'GET',
        headers: {
          Authorization: 'Bot my-token',
          'Content-Type': 'application/json',
        },
      })

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            Authorization: 'Bot my-token',
            'Content-Type': 'application/json',
          },
          auth: false,
        })
      )
    })

    it('returns a response on success', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{"id":"123"}', 200, {
        'Content-Type': 'application/json',
      }))

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      expect(res.status).toEqual(200)
      expect(res.headers['content-type']).toEqual('application/json')
      await expect(res.json()).resolves.toEqual({ id: '123' })
      await expect(res.text()).resolves.toEqual('{"id":"123"}')
    })

    it('returns a synthetic response for a DiscordAPIError', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      const rawError = { message: 'Unknown Channel', code: 10003 }
      rest.queueRequest.mockRejectedValue(
        new discordRest.DiscordAPIError(rawError, 10003, 404, 'GET', '/channels/123', { body: undefined, files: undefined })
      )

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      expect(res.status).toEqual(404)
      await expect(res.json()).resolves.toEqual(rawError)
    })

    it('returns a synthetic response for an HTTPError', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockRejectedValue(
        new discordRest.HTTPError(500, 'Internal Server Error', 'GET', '/channels/123', { body: undefined, files: undefined })
      )

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      expect(res.status).toEqual(500)
      await expect(res.json()).resolves.toEqual({ message: 'Internal Server Error' })
    })

    it('lets a RateLimitError throw through', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockRejectedValue(new discordRest.RateLimitError({ retryAfter: 0 }))

      await expect(handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' }))
        .rejects.toThrow('Rate limit exceeded')
    })

    it('defaults to GET when no method is specified', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      await handler.fetch('https://discord.com/api/v10/users/@me', {})

      expect(rest.queueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('emits next and idle when a request finishes', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))
      const nextListener = jest.fn()
      const idleListener = jest.fn()
      handler.on('next', nextListener)
      handler.on('idle', idleListener)

      await handler.fetch('https://discord.com/api/v10/channels/123', {})

      expect(nextListener).toHaveBeenCalledWith(0, 0)
      expect(idleListener).toHaveBeenCalled()
    })
  })

  describe('long running requests', () => {
    it('does not emit long running events if the request succeeds', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))
      const emitSpy = jest.spyOn(handler, 'emit')

      await handler.fetch('https://discord.com/api/v10/channels/123', {})
      jest.advanceTimersByTime(1000 * 60 * 15)

      const events = emitSpy.mock.calls.map(([event]) => event)
      expect(events).not.toContain('LongRunningBucketRequest')
      expect(events).not.toContain('longRunningHandlerRequest')
    })

    it('emits long running events if the request is hung up', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockReturnValue(new Promise(() => undefined))
      const emitSpy = jest.spyOn(handler, 'emit')

      handler.fetch('https://discord.com/api/v10/channels/123', {}).catch(() => undefined)
      await flushPromises()
      jest.advanceTimersByTime(1000 * 60 * 15)

      const events = emitSpy.mock.calls.map(([event]) => event)
      expect(events).toContain('LongRunningBucketRequest')
      expect(events).toContain('longRunningHandlerRequest')
    })
  })

  describe('rate limit event mapping', () => {
    it('emits a global block on a global rate limit', () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('globalBlock', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
          'retry-after': '5',
        }),
      })

      expect(listener).toHaveBeenCalledWith(
        GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT,
        5000,
        undefined,
      )
    })

    it('multiplies the global block duration', () => {
      const handler = new RESTHandler({ globalBlockDurationMultiple: 2 })
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('globalBlock', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
          'retry-after': '5',
        }),
      })

      expect(listener).toHaveBeenCalledWith(
        GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT,
        10000,
        undefined,
      )
    })

    it('emits a bucket rate limit', () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('rateLimit', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-bucket': 'abc',
          'x-ratelimit-reset-after': '2',
        }),
      })

      expect(listener).toHaveBeenCalledWith(
        expect.any(Object),
        2000,
      )
    })

    it('treats a 429 without a parseable duration as a Cloudflare block', () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('globalBlock', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
        }),
      })

      expect(listener).toHaveBeenCalledWith(
        GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT,
        1000 * 60 * 60 * 3,
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-ratelimit-global': 'true',
          }),
        }),
      )
    })

    it('treats a 429 with no rate limit headers as a Cloudflare block', () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('globalBlock', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders(),
      })

      expect(listener).toHaveBeenCalledWith(
        GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT,
        1000 * 60 * 60 * 3,
        expect.any(Object),
      )
    })

    it('counts 401 and 403 responses as invalid requests', () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('invalidRequest', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 401,
        headers: createMockHeaders(),
      })
      rest.emit('response', { path: '/channels/123' }, {
        status: 403,
        headers: createMockHeaders(),
      })

      expect(listener).toHaveBeenNthCalledWith(1, expect.any(Object), 1)
      expect(listener).toHaveBeenNthCalledWith(2, expect.any(Object), 2)
    })

    it('blocks globally when the invalid request threshold is reached', () => {
      const handler = new RESTHandler({ invalidRequestsThreshold: 2 })
      const rest = getMockRest(handler)
      const listener = jest.fn()
      handler.on('globalBlock', listener)

      rest.emit('response', { path: '/channels/123' }, {
        status: 401,
        headers: createMockHeaders(),
      })
      expect(listener).not.toHaveBeenCalled()

      rest.emit('response', { path: '/channels/123' }, {
        status: 403,
        headers: createMockHeaders(),
      })

      expect(listener).toHaveBeenCalledWith(
        GLOBAL_BLOCK_TYPE.INVALID_REQUEST,
        1000 * 60 * 10,
        undefined,
      )
    })

    it('waits for a global block to expire before fetching', async () => {
      const handler = new RESTHandler()
      const rest = getMockRest(handler)
      rest.queueRequest.mockResolvedValue(createMockResponse('{}'))

      rest.emit('response', { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
          'retry-after': '10',
        }),
      })

      const promise = handler.fetch('https://discord.com/api/v10/channels/123', {})
      await flushPromises()
      expect(rest.queueRequest).not.toHaveBeenCalled()

      jest.advanceTimersByTime(10000)
      await flushPromises()
      expect(rest.queueRequest).toHaveBeenCalled()

      await promise
    })
  })
})
