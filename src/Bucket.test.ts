import APIRequest from "./APIRequest"
import Bucket from "./Bucket"

describe('Bucket', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.resetAllMocks()
  })
  describe('static resolveBucketId', () => {
    it('returns all major components when they all exist', () => {
      const route = 'https://discord.com/api/guilds/123/channels/456/webhooks/789'
      const bucketHeader = 'bucketheader'
      const resolved = Bucket.resolveBucketId(route, bucketHeader)
      const expected = `${bucketHeader}-123-456-789`
      expect(resolved).toEqual(expected)
    })
    describe('when some components do not exist', () => {
      it('returns correctly when the guild is unavailable', () => {
        const route = 'https://discord.com/api/channels/456/webhooks/789'
        const bucketHeader = 'bucketheader'
        const resolved = Bucket.resolveBucketId(route, bucketHeader)
        const expected = `${bucketHeader}--456-789`
        expect(resolved).toEqual(expected)
      })
      it('returns correctly when the channel is unavailable', () => {
        const route = 'https://discord.com/api/guilds/123/webhooks/789'
        const bucketHeader = 'bucketheader'
        const resolved = Bucket.resolveBucketId(route, bucketHeader)
        const expected = `${bucketHeader}-123--789`
        expect(resolved).toEqual(expected)
      })
      it('returns correctly when the webhook is unavailable', () => {
        const route = 'https://discord.com/api/guilds/123/channels/456'
        const bucketHeader = 'bucketheader'
        const resolved = Bucket.resolveBucketId(route, bucketHeader)
        const expected = `${bucketHeader}-123-456-`
        expect(resolved).toEqual(expected)
      })
      it('returns correctly when bucket is unavailable', () => {
        const route = 'https://discord.com/api/guilds/123/channels/456/webhooks/789'
        const bucketHeader = ''
        const resolved = Bucket.resolveBucketId(route, bucketHeader)
        const expected = `-123-456-789`
        expect(resolved).toEqual(expected)
      })
    })
    it('returns the route when no major parameters are available', () => {
      const route = 'https://discord.com/api/users/123'
        const bucketHeader = ''
        const resolved = Bucket.resolveBucketId(route, bucketHeader)
        const expected = route
        expect(resolved).toEqual(expected)
    })
  })
  describe('static hasBucketLimits', () => {
    it('returns true correctly', () => {
      const withBucketHeaders = {[Bucket.constants.RATELIMIT_BUCKET]: 'bucketheader'}
      const result1 = Bucket.hasBucketLimits(withBucketHeaders)
      expect(result1).toEqual(true)
    })
    it('returns false correctly', () => {
      const result2 = Bucket.hasBucketLimits({})
      expect(result2).toEqual(false)
    })
  })
  describe('static getBucketBlockDurationMs', () => {
    it('returns the bucket block duration in ms', () => {
      const blockDurationSeconds = '3'
      const headers = {
        [Bucket.constants.RATELIMIT_REMAINING]: '0',
        [Bucket.constants.RATELIMIT_RESET_AFTER]: blockDurationSeconds
      }
      const result = Bucket.getBucketBlockDurationMs(headers, false)
      expect(result).toEqual(Number(blockDurationSeconds) * 1e3)
    })
    it('returns -1 if there are remaining requests that can be done', () => {
      const headers = {
        [Bucket.constants.RATELIMIT_REMAINING]: '2',
        [Bucket.constants.RATELIMIT_RESET_AFTER]: '3', // This should be ignored
      }
      const result = Bucket.getBucketBlockDurationMs(headers, false)
      expect(result).toEqual(-1)
    })
    it('returns the block duration in ms if we ignore remaining', () => {
      const blockDurationSeconds = '3'
      const headers = {
        [Bucket.constants.RATELIMIT_REMAINING]: '2',
        [Bucket.constants.RATELIMIT_RESET_AFTER]: blockDurationSeconds // This should be ignored
      }
      const result = Bucket.getBucketBlockDurationMs(headers, true)
      expect(result).toEqual(Number(blockDurationSeconds) * 1e3)
    })
    it('returns -1 if the header cannot be parsed as a number', () => {
      const blockDurationSeconds = 'abc'
      const headers = {
        [Bucket.constants.RATELIMIT_REMAINING]: 'def',
        [Bucket.constants.RATELIMIT_RESET_AFTER]: blockDurationSeconds
      }
      const result = Bucket.getBucketBlockDurationMs(headers, false)
      expect(result).toEqual(-1)
    })
  })

  describe('static isGloballyBlocked', () => {
    it('returns true correctly', () => {
      const headers = {
        [Bucket.constants.RATELIMIT_GLOBAL]: 'true',
      }
      const result = Bucket.isGloballyBlocked(headers)
      expect(result).toEqual(true)
    })
    it('returns false correctly', () => {
      const result = Bucket.isGloballyBlocked({})
      expect(result).toEqual(false)
    })
  })

  describe('static getGlobalBlockDurationMs', () => {
    it('returns the retry after header number', () => {
      const retryAfterMs = '2000'
      const headers = {
        [Bucket.constants.RETRY_AFTER]: retryAfterMs,
      }
      const result = Bucket.getGlobalBlockDurationMs(headers)
      expect(result).toEqual(Number(retryAfterMs))
    })
    it('returns -1 if try after header is not a number', () => {
      const retryAfterMs = 'abc'
      const headers = {
        [Bucket.constants.RETRY_AFTER]: retryAfterMs,
      }
      const result = Bucket.getGlobalBlockDurationMs(headers)
      expect(result).toEqual(-1)
    })
  })

  describe('getBlockedDuration', () => {
    it('returns the global block duration if there is a global block', () => {
      const globalBlockDuration = 100
      jest.spyOn(Bucket, 'isGloballyBlocked')
        .mockReturnValue(true)
      jest.spyOn(Bucket, 'getGlobalBlockDurationMs')
        .mockReturnValue(globalBlockDuration)
      jest.spyOn(Bucket, 'hasBucketLimits')
        .mockReturnValue(false)
      const result = Bucket.getBlockedDuration({})
      expect(result).toEqual(globalBlockDuration)
    })
    it('returns the bucket block duration if there is a bucket block', () => {
      const bucketBlockDuration = 100
      jest.spyOn(Bucket, 'hasBucketLimits')
        .mockReturnValue(true)
      jest.spyOn(Bucket, 'getBucketBlockDurationMs')
        .mockReturnValue(bucketBlockDuration)
      jest.spyOn(Bucket, 'isGloballyBlocked')
        .mockReturnValue(false)
      const result = Bucket.getBlockedDuration({})
      expect(result).toEqual(bucketBlockDuration)
    })
  })

  describe('block', () => {
    it('works', () => {
      const blockDuration = 1000
      const bucket = new Bucket('id')
      bucket.blockedUntil = undefined
      bucket.block(blockDuration)
      expect(bucket.blockedUntil).toBeDefined()
      jest.advanceTimersByTime(1000)
      expect(bucket.blockedUntil).toBeUndefined()
    })
  })

  describe('copyBlockTo', () => {
    it('works', () => {
      const nowDate = new Date('2020-01-01')
      const endBlockDate = new Date('2020-02-01')
      const bucket = new Bucket('id')
      bucket.blockedUntil = endBlockDate
      const otherBucket = {
        block: jest.fn()
      } as unknown as Bucket
      jest.spyOn(global, 'Date')
        .mockImplementation(() => nowDate as unknown as string)
      const expectedBlockDuration = endBlockDate.getTime() - nowDate.getTime()
      bucket.copyBlockTo(otherBucket)
      expect(otherBucket.block).toHaveBeenCalledWith(expectedBlockDuration)
    })
  })

  describe('enqueue', () => {
    it('enqueues synchronously', async () => {
      const bucket = new Bucket('id')
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'finishHandling')
        .mockImplementation()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'waitForRequest')
        .mockImplementation()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'execute')
        .mockImplementation()
      const numberOfRequests = 100
      const promises = []
      for (let i = 0; i < numberOfRequests; ++i) {
        promises.push(bucket.enqueue({
          id: i,
          toString: jest.fn()
        } as unknown as APIRequest))
      }
      // Assert before they can resolve
      for (let i = 0; i < numberOfRequests; ++i) {
        expect(bucket['queue'][i]).toHaveProperty('id', i)
      }
      // Now wait for them to resolve to end the test
      await Promise.all(promises)
    })
    it('executes all enqueued items in order', async () => {
      const bucket = new Bucket('id')
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'finishHandling')
        .mockImplementation()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'waitForRequest')
        .mockImplementation()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const bucketExecute = jest.spyOn(bucket, 'execute')
        .mockImplementation()
      const numberOfRequests = 100
      const apiRequests = []
      const promises = []
      for (let i = 0; i < numberOfRequests; ++i) {
        const apiRequest = {
          id: i,
          toString: jest.fn()
        } as unknown as APIRequest
        apiRequests.push(apiRequest)
        promises.push(bucket.enqueue(apiRequest))
      }
      await Promise.all(promises)
      for (let i = 0; i < numberOfRequests; ++i) {
        const apiRequest = apiRequests[i]
        expect(bucketExecute).toHaveBeenNthCalledWith(i + 1, apiRequest)
      }
    })
    it('removes all the items from the queue after completion', async () => {
      const bucket = new Bucket('id')
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'finishHandling')
        .mockImplementation()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'waitForRequest')
        .mockImplementation()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(bucket, 'execute')
        .mockImplementation()
      const request1 = {
        id: 1,
        toString: jest.fn()
      } as unknown as APIRequest
      const request2 = {
        id: 2,
        toString: jest.fn()
      } as unknown as APIRequest
      const promises = []
      promises.push(bucket.enqueue(request1))
      promises.push(bucket.enqueue(request2))
      expect(bucket['queue']).toHaveLength(2)
      await Promise.all(promises)
      expect(bucket['queue']).toHaveLength(0)
    })
  })
})
