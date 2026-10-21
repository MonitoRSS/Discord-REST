import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { REST, RESTEvents, DiscordAPIError, HTTPError, RateLimitError } from '@discordjs/rest'
import RESTHandler from './RESTHandler'
import { GLOBAL_BLOCK_TYPE } from './constants/global-block-type'

function flushPromises (times = 10): Promise<void> {
  let chain = Promise.resolve()
  for (let i = 0; i < times; i++) {
    chain = chain.then(() => undefined)
  }
  return chain
}

function getRest (handler: RESTHandler, api = 'https://discord.com/api', version = '10'): REST {
  return (handler as any).getRest(api, version)
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

type QueueRequest = (options: any) => any

function stubQueueRequest (handler: RESTHandler, response?: QueueRequest, api?: string) {
  const rest = getRest(handler, api)
  const calls: any[] = []
  const queueRequest: QueueRequest = async (options) => {
    calls.push(options)
    return response ? response(options) : createMockResponse('{}')
  }

  ;(rest as any).queueRequest = queueRequest

  return { rest, calls }
}

function assertSubset (actual: Record<string, any>, expected: Record<string, any>) {
  for (const key of Object.keys(expected)) {
    assert.deepEqual(actual[key], expected[key], `Expected property "${key}" to match`)
  }
}

describe('RESTHandler', () => {
  describe('constructor', () => {
    it('creates a REST instance with mapped options', () => {
      const handler = new RESTHandler({
        requestTimeout: 5000,
        requestTimeoutRetries: 2,
        maxRequestsPerSecond: 30,
      })
      const rest = getRest(handler)

      assertSubset(rest.options as any, {
        timeout: 5000,
        retries: 2,
        globalRequestsPerSecond: 30,
        api: 'https://discord.com/api',
        version: '10',
      })
      assert.equal(typeof rest.options.rejectOnRateLimit, 'function')
    })

    it('uses defaults when no options provided', () => {
      const handler = new RESTHandler()
      const rest = getRest(handler)

      assertSubset(rest.options as any, {
        timeout: 1000 * 60,
        retries: 3,
        globalRequestsPerSecond: 35,
      })
    })
  })

  describe('fetch', () => {
    it('extracts the route from a full URL with a version', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler, () => createMockResponse('{"ok":true}'))

      await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        fullRoute: '/channels/123',
        method: 'GET',
        auth: false,
        versioned: true,
      })
    })

    it('extracts the route from a full URL without a version', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler)

      await handler.fetch('https://discord.com/api/channels/456', { method: 'POST' })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        fullRoute: '/channels/456',
        method: 'POST',
      })
    })

    it('keeps the query string', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler)

      await handler.fetch('https://discord.com/api/v10/channels/123/messages?wait=true', { method: 'POST' })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        fullRoute: '/channels/123/messages?wait=true',
      })
    })

    it('uses a separate REST instance for a non-Discord host', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler, undefined, 'http://127.0.0.1:9999/api')

      await handler.fetch('http://127.0.0.1:9999/api/v10/channels/123/messages', { method: 'POST' })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        fullRoute: '/channels/123/messages',
        versioned: true,
      })
    })

    it('parses a JSON string body into an object', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler)

      await handler.fetch('https://discord.com/api/v10/channels/123/messages', {
        method: 'POST',
        body: JSON.stringify({ content: 'hello' }),
      })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        body: { content: 'hello' },
      })
    })

    it('passes a non-JSON string body through unchanged', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler)

      await handler.fetch('https://discord.com/api/v10/channels/123/messages', {
        method: 'POST',
        body: 'not-json',
      })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        body: 'not-json',
        passThroughBody: true,
      })
    })

    it('forwards the Authorization header without letting the REST client override it', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler)

      await handler.fetch('https://discord.com/api/v10/channels/123', {
        method: 'GET',
        headers: {
          Authorization: 'Bot my-token',
          'Content-Type': 'application/json',
        },
      })

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        headers: {
          Authorization: 'Bot my-token',
          'Content-Type': 'application/json',
        },
        auth: false,
      })
    })

    it('returns a response on success', async () => {
      const handler = new RESTHandler()
      stubQueueRequest(handler, () => createMockResponse('{"id":"123"}', 200, {
        'Content-Type': 'application/json',
      }))

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      assert.equal(res.status, 200)
      assert.equal(res.headers['content-type'], 'application/json')
      assert.deepEqual(await res.json(), { id: '123' })
      assert.equal(await res.text(), '{"id":"123"}')
    })

    it('returns a synthetic response for a DiscordAPIError', async () => {
      const handler = new RESTHandler()
      const rawError = { message: 'Unknown Channel', code: 10003 }
      stubQueueRequest(handler, async () => {
        throw new DiscordAPIError(rawError, 10003, 404, 'GET', '/channels/123', { body: undefined, files: undefined })
      })

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      assert.equal(res.status, 404)
      assert.deepEqual(await res.json(), rawError)
    })

    it('returns a synthetic response for a DiscordAPIError with a non-JSON body', async () => {
      const handler = new RESTHandler()
      stubQueueRequest(handler, async () => {
        const body = new TextEncoder().encode('text here')
        throw new DiscordAPIError(body.buffer as any, 0, 400, 'GET', '/channels/123', { body: undefined, files: undefined })
      })

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      assert.equal(res.status, 400)
      assert.equal(res.headers['content-type'], 'text/plain')
      assert.equal(await res.text(), 'text here')
    })

    it('returns a synthetic response for an HTTPError', async () => {
      const handler = new RESTHandler()
      stubQueueRequest(handler, async () => {
        throw new HTTPError(500, 'Internal Server Error', 'GET', '/channels/123', { body: undefined, files: undefined })
      })

      const res = await handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' })

      assert.equal(res.status, 500)
      assert.deepEqual(await res.json(), { message: 'Internal Server Error' })
    })

    it('lets a RateLimitError throw through', async () => {
      const handler = new RESTHandler()
      stubQueueRequest(handler, async () => {
        throw new RateLimitError({ retryAfter: 0 } as any)
      })

      await assert.rejects(
        handler.fetch('https://discord.com/api/v10/channels/123', { method: 'GET' }),
        RateLimitError,
      )
    })

    it('defaults to GET when no method is specified', async () => {
      const handler = new RESTHandler()
      const { calls } = stubQueueRequest(handler)

      await handler.fetch('https://discord.com/api/v10/users/@me', {})

      assert.equal(calls.length, 1)
      assertSubset(calls[0], {
        method: 'GET',
      })
    })

    it('emits next and idle when a request finishes', async () => {
      const handler = new RESTHandler()
      stubQueueRequest(handler)
      const nextCalls: number[][] = []
      let idleCalls = 0
      handler.on('next', (queueSize, pending) => nextCalls.push([queueSize, pending]))
      handler.on('idle', () => idleCalls++)

      await handler.fetch('https://discord.com/api/v10/channels/123', {})

      assert.deepEqual(nextCalls, [[0, 0]])
      assert.equal(idleCalls, 1)
    })
  })

  describe('long running requests', () => {
    it('does not emit long running events if the request succeeds', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
      const handler = new RESTHandler()
      stubQueueRequest(handler)
      let longRunningEvents = 0
      handler.on('LongRunningBucketRequest', () => longRunningEvents++)
      handler.on('longRunningHandlerRequest', () => longRunningEvents++)

      await handler.fetch('https://discord.com/api/v10/channels/123', {})
      t.mock.timers.tick(1000 * 60 * 15)

      assert.equal(longRunningEvents, 0)
    })

    it('emits long running events if the request is hung up', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
      const handler = new RESTHandler()
      stubQueueRequest(handler, () => new Promise(() => undefined))
      const events: string[] = []
      handler.on('LongRunningBucketRequest', () => events.push('LongRunningBucketRequest'))
      handler.on('longRunningHandlerRequest', () => events.push('longRunningHandlerRequest'))

      handler.fetch('https://discord.com/api/v10/channels/123', {}).catch(() => undefined)
      await flushPromises()
      t.mock.timers.tick(1000 * 60 * 15)

      assert.ok(events.includes('LongRunningBucketRequest'))
      assert.ok(events.includes('longRunningHandlerRequest'))
    })
  })

  describe('rate limit event mapping', () => {
    it('emits a global block on a global rate limit', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler()
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('globalBlock', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
          'retry-after': '5',
        }),
      })

      assert.deepEqual(calls, [[GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT, 5000, undefined]])
    })

    it('multiplies the global block duration', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler({ globalBlockDurationMultiple: 2 })
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('globalBlock', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
          'retry-after': '5',
        }),
      })

      assert.deepEqual(calls, [[GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT, 10000, undefined]])
    })

    it('emits a bucket rate limit', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler()
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('rateLimit', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-bucket': 'abc',
          'x-ratelimit-reset-after': '2',
        }),
      })

      assert.equal(calls.length, 1)
      assert.ok(calls[0][0] instanceof Object)
      assert.equal(calls[0][1], 2000)
    })

    it('treats a 429 without a parseable duration as a Cloudflare block', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler()
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('globalBlock', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
        }),
      })

      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT)
      assert.equal(calls[0][1], 1000 * 60 * 60 * 3)
      assert.deepEqual(calls[0][2], {
        headers: {
          'x-ratelimit-global': 'true',
        },
      })
    })

    it('treats a 429 with no rate limit headers as a Cloudflare block', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler()
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('globalBlock', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders(),
      })

      assert.equal(calls.length, 1)
      assert.equal(calls[0][0], GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT)
      assert.equal(calls[0][1], 1000 * 60 * 60 * 3)
    })

    it('counts 401 and 403 responses as invalid requests', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler()
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('invalidRequest', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 401,
        headers: createMockHeaders(),
      })
      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 403,
        headers: createMockHeaders(),
      })

      assert.equal(calls.length, 2)
      assert.equal(calls[0][1], 1)
      assert.equal(calls[1][1], 2)
    })

    it('blocks globally when the invalid request threshold is reached', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler({ invalidRequestsThreshold: 2 })
      const rest = getRest(handler)
      const calls: any[][] = []
      handler.on('globalBlock', (...args) => calls.push(args))

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 401,
        headers: createMockHeaders(),
      })
      assert.equal(calls.length, 0)

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 403,
        headers: createMockHeaders(),
      })

      assert.deepEqual(calls, [[GLOBAL_BLOCK_TYPE.INVALID_REQUEST, 1000 * 60 * 10, undefined]])
    })

    it('waits for a global block to expire before fetching', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
      const handler = new RESTHandler()
      const rest = getRest(handler)
      const { calls } = stubQueueRequest(handler)

      ;(rest as any).emit(RESTEvents.Response, { path: '/channels/123' }, {
        status: 429,
        headers: createMockHeaders({
          'x-ratelimit-global': 'true',
          'retry-after': '10',
        }),
      })

      const promise = handler.fetch('https://discord.com/api/v10/channels/123', {})
      await flushPromises()
      assert.equal(calls.length, 0)

      t.mock.timers.tick(10000)
      await flushPromises()
      assert.equal(calls.length, 1)

      await promise
    })
  })
})
