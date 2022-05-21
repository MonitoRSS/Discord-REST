import APIRequest from "./APIRequest"
import Bucket from "./Bucket"
import RESTHandler from "./RESTHandler"
import { mocked } from 'ts-jest/utils'

jest.mock('./APIRequest')

const APIRequestMocked = mocked(APIRequest)

const okResponse = {
  status: 200,
  headers: new Map()
} as unknown as Response

async function flushPromises(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

describe('RESTHandler', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })
  describe('requests in the same bucket', () => {
    it('still executes enqueued requests after a global limit hit', async () => {
      // Set up the test to cause a global rate limit on the first request
      const globalBlockDuration = '99999999'
      const firstRequestResponse = {
        status: 429,
        headers: new Map([
          [Bucket.constants.RATELIMIT_GLOBAL, 'true'],
          [Bucket.constants.RETRY_AFTER, globalBlockDuration]
        ])
      } as unknown as Response
      jest.spyOn(APIRequest.prototype, 'execute')
        .mockResolvedValueOnce(firstRequestResponse)
        .mockResolvedValue(okResponse)
      const handler = new RESTHandler()
      // Enqueue all request
      const prom1 = handler.fetch('https://whatever.com/channels/123', {})
      const prom2 = handler.fetch('https://whatever.com/channels/123', {})
      const prom3 = handler.fetch('https://whatever.com/channels/123', {})
      await flushPromises()
      expect(APIRequestMocked.mock.instances[0].execute)
        .toHaveBeenCalled()
      expect(APIRequestMocked.mock.instances[1].execute)
        .not.toHaveBeenCalled()
      expect(APIRequestMocked.mock.instances[2].execute)
        .not.toHaveBeenCalled()
      // Run all timers for blocks to expire
      jest.advanceTimersByTime(Number(globalBlockDuration))
      await flushPromises()
      expect(APIRequestMocked.mock.instances[1].execute)
        .toHaveBeenCalled()
      expect(APIRequestMocked.mock.instances[2].execute)
        .toHaveBeenCalled()
      // Assert all requests after the first one was run
      await expect(Promise.all([prom1, prom2, prom3])).resolves.toEqual([
        okResponse,
        okResponse,
        okResponse
      ])
    })
    it('still executes enqueued requests after a failure', async () => {
      // Set up test to cause a failure on the first request
      const firstRequestError = new Error('random fetch error')
      jest.spyOn(APIRequest.prototype, 'execute')
        .mockRejectedValueOnce(firstRequestError)
        .mockResolvedValue(okResponse)
      const handler = new RESTHandler()
      // Enqueue all requests
      const prom1 = handler.fetch('https://whatever.com/channels/123', {})
      const prom2 = handler.fetch('https://whatever.com/channels/123', {})
      const prom3 = handler.fetch('https://whatever.com/channels/123', {})
      await expect(prom1).rejects.toThrow(firstRequestError)
      await flushPromises()
      expect(APIRequestMocked.mock.instances[0].execute)
        .toHaveBeenCalled()
      expect(APIRequestMocked.mock.instances[1].execute)
        .toHaveBeenCalled()
      expect(APIRequestMocked.mock.instances[2].execute)
        .toHaveBeenCalled()
      // Assert all requests after the first one was run
      expect(Promise.all([prom2, prom3])).resolves.toEqual([
        okResponse,
        okResponse
      ])
    })
  })
})
