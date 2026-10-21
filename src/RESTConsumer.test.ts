import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import RESTConsumer from './RESTConsumer'

function createMessage (json: unknown): any {
  return {
    content: {
      toString: () => JSON.stringify(json),
    },
  }
}

describe('RESTConsumer', () => {
  let consumer: RESTConsumer

  beforeEach(() => {
    consumer = new RESTConsumer('uri', {
      authHeader: 'header',
      clientId: 'client-id',
      checkIsDuplicate: async () => false,
    })
  })

  describe('validateMessage', () => {
    it('should throw an error if the message is not JSON', async () => {
      await assert.rejects(consumer.validateMessage('string' as never), Error)
    })

    const invalidMessages: Array<[string, Record<string, unknown>]> = [
      ['missing id', { route: 'route', options: { headers: {} }, meta: {}, startTimestamp: 1 }],
      ['missing route', { id: 'id', options: { headers: {} }, meta: {}, startTimestamp: 1 }],
    ]

    for (const [name, json] of invalidMessages) {
      it(`should throw an error if the json does not match the expected shape (${name})`, async () => {
        await assert.rejects(consumer.validateMessage(createMessage(json)), Error)
      })
    }

    const validMessages: Array<[string, Record<string, unknown>]> = [
      ['all fields', { id: 'id', route: 'route', options: { headers: {} }, meta: {}, body: {}, rpc: false, startTimestamp: 1 }],
      ['optional rpc', { id: 'id', route: 'route', options: { headers: {} }, meta: {}, body: {}, startTimestamp: 1 }],
      ['custom headers', { id: 'id', route: 'route', options: { headers: { random: 'header' }, startTimestamp: 1 }, meta: {}, body: {}, rpc: true, startTimestamp: 1 }],
    ]

    for (const [name, json] of validMessages) {
      it(`should return the job data if the json matches the expected shape (${name})`, async () => {
        assert.deepEqual(await consumer.validateMessage(createMessage(json)), json)
      })
    }
  })
})
