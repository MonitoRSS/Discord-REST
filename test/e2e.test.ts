import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import RESTConsumer from '../src/RESTConsumer'
import RESTProducer from '../src/RESTProducer'

const fallbackUri = 'amqp://localhost:5672'
const RABBITMQ_URI = process.env.RABBITMQ_URI || fallbackUri

function handleRequest (req: IncomingMessage, res: ServerResponse) {
  switch (req.url) {
    case '/messages':
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ foo: 'bar' }))
      return
    case '/bad-request':
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ foo: 'bar' }))
      return
    case '/no-content':
      res.writeHead(204)
      res.end()
      return
    case '/text':
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('text here')
      return
    case '/network-error':
      req.socket.destroy()
      return
    default:
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'Not Found' }))
  }
}

describe('e2e test', () => {
  let consumer: RESTConsumer
  let producer: RESTProducer
  let server: Server
  let baseUrl: string
  const clientId = 'test:client-id'

  before(async () => {
    if (!RABBITMQ_URI) {
      throw new Error('process.env.RABBITMQ_URI is not set')
    }

    server = createServer(handleRequest)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`

    consumer = new RESTConsumer(RABBITMQ_URI, {
      authHeader: 'header',
      clientId,
      autoDeleteQueues: true,
      checkIsDuplicate: async () => false,
    })
    await consumer.initialize()

    producer = new RESTProducer(RABBITMQ_URI, {
      clientId,
      autoDeleteQueues: true,
    })
    await producer.initialize()
  })

  describe('producer', () => {
    describe('fetch', () => {
      it('returns the correct properties on successful fetch', async () => {
        const result = await producer.fetch(`${baseUrl}/messages`)
        assert.equal(result.state, 'success')

        if (result.state === 'success') {
          assert.deepEqual(result.body, { foo: 'bar' })
          assert.equal(result.status, 200)
        }
      })

      it('returns the correct properties on non-200 fetch', async () => {
        const result = await producer.fetch(`${baseUrl}/bad-request`)
        assert.equal(result.state, 'success')

        if (result.state === 'success') {
          assert.deepEqual(result.body, { foo: 'bar' })
          assert.equal(result.status, 400)
        }
      })

      it('returns the correct properties on a status code 204', async () => {
        const result = await producer.fetch(`${baseUrl}/no-content`)
        assert.equal(result.state, 'success')

        if (result.state === 'success') {
          assert.equal(result.body, null)
          assert.equal(result.status, 204)
        }
      })

      it('returns if content is not json', async () => {
        const result = await producer.fetch(`${baseUrl}/text`)
        assert.equal(result.state, 'success')

        if (result.state === 'success') {
          assert.equal(result.body, 'text here')
          assert.equal(result.status, 400)
        }
      })

      it('returns with error if fetch failed', async () => {
        const result = await producer.fetch(`${baseUrl}/network-error`)
        assert.equal(result.state, 'error')

        if (result.state === 'error') {
          assert.ok(result.message)
        }
      })
    })
  })

  after(async () => {
    await consumer?.close()
    await producer?.close()
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve())
      })
    }
  })
})
