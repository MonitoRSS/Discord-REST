import APIRequest from "./APIRequest"
import Bucket from "./Bucket"
import RESTHandler from "./RESTHandler"
import { mocked } from 'ts-jest/utils'
import { FetchResponse } from "./types/FetchResponse"

jest.mock('./APIRequest')

const APIRequestMocked = mocked(APIRequest)

const okResponse = {
  status: 200,
  headers: {}
} as FetchResponse

async function flushPromises(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

jest.useFakeTimers()

describe('RESTHandler', () => {
  beforeEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
  })

  describe('requests in the same bucket', () => {
    it('does not emit long running request if a job is successful', async () => {
      jest.spyOn(APIRequest.prototype, 'execute')
        .mockResolvedValue(okResponse)
      const handler = new RESTHandler()
      const handlerEmit = jest.spyOn(handler, 'emit')
      await handler.fetch('https://whatever.com/channels/123', {})
      jest.advanceTimersByTime(1000 * 60 * 15)

      const allEventsEmitted = handlerEmit.mock.calls.map(([event]) => event)
      expect(allEventsEmitted).not.toContain('LongRunningBucketRequest')
    })

    it('emits long running request if a job is hung up', async () => {
      jest.spyOn(APIRequest.prototype, 'execute')
        .mockImplementation(async () => {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve()
            }, 1e15)
          }) as never
        })
  
      const handler = new RESTHandler()
      const handlerEmit = jest.spyOn(handler, 'emit')

      handler.fetch('https://whatever.com/channels/123', {})
      jest.advanceTimersByTime(1000 * 60 * 15)

      const allEventsEmitted = handlerEmit.mock.calls.map(([event]) => event)
      expect(allEventsEmitted).toContain('LongRunningBucketRequest')
      jest.runAllTimers()
    })

    it('still executes enqueued requests after a global limit hit', async () => {
      // Set up the test to cause a global rate limit on the first request
      const globalBlockDuration = '99999999'
      const firstRequestResponse = {
        status: 429,
        headers: {
          [Bucket.constants.RATELIMIT_GLOBAL]: 'true',
          [Bucket.constants.RETRY_AFTER]: globalBlockDuration
        }
      } as FetchResponse
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
