import APIRequest from './APIRequest'
import { Interceptable, MockAgent, setGlobalDispatcher } from 'undici'

describe('APIRequest', () => {
  const dummyHost = 'https://example.com'
  const dummyEndpoint = '/messages'
  const dummyUrl = dummyHost + dummyEndpoint
  let client: Interceptable
  const interceptDetails = {
    path: dummyEndpoint,
    method: 'GET',
  }

  beforeEach(() => {
    const agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
    client = agent.get(dummyHost)
  })

  afterEach(() => {
    APIRequest.lastId = 0
    jest.resetAllMocks()
    client.destroy()
  })
  describe('constructor', () => {
    it('auto-increments the id', async () => {
      const apiRequest1 = new APIRequest('route')
      const apiRequest2 = new APIRequest('route')
      const apiRequest3 = new APIRequest('route')
      expect(apiRequest1['id']).toEqual(1)
      expect(apiRequest2['id']).toEqual(2)
      expect(apiRequest3['id']).toEqual(3)
      expect(APIRequest.lastId).toEqual(3)
    })
  })
  describe('execute', () => {
    it('returns the fetch response on success', async () => {
      const response = {
        foo: 'bar'
      } as unknown as Response
      
      client.intercept(interceptDetails).reply(200, response)

      const apiRequest = new APIRequest(dummyUrl)
      const result = await apiRequest.execute()
      await expect(result.json()).resolves.toEqual(response)
    })

    it('throws the same error that fetch throws', async () => {
      const fetchError = new Error('fetch error example')

      client.intercept(interceptDetails).replyWithError(fetchError)

      const apiRequest = new APIRequest(dummyUrl, {
        maxRetries: 0
      })
      await expect(apiRequest.execute())
        .rejects.toThrow(fetchError)
    })

    it('retries correctly on fetch error', async () => {
      const fetchError = new Error('fetch error example')

      client.intercept(interceptDetails).replyWithError(fetchError)

      const apiRequest = new APIRequest(dummyUrl, {
        maxRetries: 3
      })
      const sendFetchSpy = jest.spyOn(apiRequest, 'sendFetch')
      await expect(apiRequest.execute({
        baseAttemptDelay: 1
      })).rejects.toThrow()

      expect(sendFetchSpy).toHaveBeenCalledTimes(4)
    })

    it('retries correctly times on 422 code', async () => {
      client.intercept(interceptDetails).reply(422, {})
      client.intercept(interceptDetails).reply(422, {})
      client.intercept(interceptDetails).reply(422, {})
      client.intercept(interceptDetails).reply(422, {})

      const apiRequest = new APIRequest(dummyUrl, {
        maxRetries: 3
      })
      const sendFetchSpy = jest.spyOn(apiRequest, 'sendFetch')
      await apiRequest.execute({
        baseAttemptDelay: 1
      })

      expect(sendFetchSpy).toHaveBeenCalledTimes(4)
    })

    it('returns with a status of 422 and does not throw', async   () => {
      client.intercept(interceptDetails).reply(422, {})
      client.intercept(interceptDetails).reply(422, {})
      client.intercept(interceptDetails).reply(422, {})

      const apiRequest = new APIRequest(dummyUrl, {
        maxRetries: 2
      })

      const { status } = await apiRequest.execute({
        baseAttemptDelay: 1
      })

      expect(status).toEqual(422)
    })

    it('retries correctly on >= 500 codes', async () => {
      client.intercept(interceptDetails).reply(500, {})
      client.intercept(interceptDetails).reply(501, {})
      client.intercept(interceptDetails).reply(503, {})
      client.intercept(interceptDetails).reply(504, {})

      const apiRequest = new APIRequest(dummyUrl, {
        maxRetries: 3,
      })
      const sendFetchSpy = jest.spyOn(apiRequest, 'sendFetch')
      await apiRequest.execute({
        baseAttemptDelay: 1,
      })

      expect(sendFetchSpy).toHaveBeenCalledTimes(4)
    })

    it('returns with a status of 500 and does not throw', async   () => {
      client.intercept(interceptDetails).reply(500, {}).persist()

      const apiRequest = new APIRequest(dummyUrl, {
        maxRetries: 2
      })

      const { status } = await apiRequest.execute({
        baseAttemptDelay: 1
      })

      expect(status).toEqual(500)
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
 