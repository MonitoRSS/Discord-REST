import fetch, { Response } from 'node-fetch'
import { mocked } from 'ts-jest'
import APIRequest from './APIRequest'

jest.mock('node-fetch')

const fetchMocked = mocked(fetch)

describe('APIRequest', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    APIRequest.lastId = 0
    jest.resetAllMocks()
    fetchMocked.mockReset()
  })
  describe('constructor', () => {
    it('auto-increments the id', async () => {
      const apiRequest1 = new APIRequest('route')
      const apiRequest2 = new APIRequest('route')
      const apiRequest3 = new APIRequest('route')
      expect(apiRequest1.id).toEqual(1)
      expect(apiRequest2.id).toEqual(2)
      expect(apiRequest3.id).toEqual(3)
      expect(APIRequest.lastId).toEqual(3)
    })
  })
  describe('execute', () => {
    it('returns the fetch response on success', async () => {
      const response = {
        foo: 'bar'
      } as unknown as Response
      fetchMocked.mockResolvedValue(response)
      const apiRequest = new APIRequest('route')
      const result = await apiRequest.execute()
      expect(result).toEqual(response)
    })
    it('throws the same error that fetch throws', async () => {
      const fetchError = new Error('fetch error example')
      fetchMocked.mockRejectedValue(fetchError)
      const apiRequest = new APIRequest('route')
      await expect(apiRequest.execute())
        .rejects.toThrow(fetchError)
    })
  })
  describe('toString', () => {
    it('returns a string', async () => {
      const apiRequest = new APIRequest('route')
      const result = apiRequest.toString()
      expect(typeof result === 'string').toEqual(true)
    })
  })
})
