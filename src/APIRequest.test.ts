import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import APIRequest from './APIRequest'

describe('APIRequest', () => {
  afterEach(() => {
    APIRequest.lastId = 0
  })

  describe('constructor', () => {
    it('auto-increments the id', () => {
      const apiRequest1 = new APIRequest('route')
      const apiRequest2 = new APIRequest('route')
      const apiRequest3 = new APIRequest('route')
      assert.equal(apiRequest1.id, 1)
      assert.equal(apiRequest2.id, 2)
      assert.equal(apiRequest3.id, 3)
      assert.equal(APIRequest.lastId, 3)
    })

    it('stores route and options', () => {
      const options = { method: 'GET', headers: { foo: 'bar' } }
      const apiRequest = new APIRequest('https://discord.com/api/v10/channels/123', options)
      assert.equal(apiRequest.route, 'https://discord.com/api/v10/channels/123')
      assert.deepEqual(apiRequest.options, options)
    })
  })

  describe('toString', () => {
    it('returns a string with the route and id', () => {
      const apiRequest = new APIRequest('https://discord.com/api/v10/channels/123')
      const result = apiRequest.toString()
      assert.equal(result, 'https://discord.com/api/v10/channels/123 (#1)')
    })
  })
})
