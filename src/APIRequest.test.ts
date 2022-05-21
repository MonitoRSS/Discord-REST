import APIRequest from './APIRequest'
import nock from 'nock'


describe('APIRequest', () => {
  const dummyUrl = 'https://example.com'

  beforeEach(() => {
    nock.cleanAll()
  })
  afterEach(() => {
    APIRequest.lastId = 0
    jest.resetAllMocks()
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
      
      nock(dummyUrl)
        .get('/')
        .reply(200, response)

      const apiRequest = new APIRequest(dummyUrl)
      const result = await apiRequest.execute()
      await expect(result.json()).resolves.toEqual(response)
    })

    it('throws the same error that fetch throws', async () => {
      const fetchError = new Error('fetch error example')

      nock(dummyUrl)
        .get('/')
        .replyWithError(fetchError)

      const apiRequest = new APIRequest(dummyUrl)
      await expect(apiRequest.execute())
        .rejects.toThrow()
    })

    it('retries 3 times on 422 code', async () => {
      const nockScope = nock(dummyUrl)
        .get('/')
        .reply(422, {})
        .get('/')
        .reply(422, {})
        .get('/')
        .reply(422, {})
        .get('/')
        .reply(422, {})

      const apiRequest = new APIRequest(dummyUrl)
      await apiRequest.execute({
        baseAttemptDelay: 1
      })

      expect(nockScope.isDone()).toBe(true)
    })

    it('retries 3 times on >= 500 codes', async () => {
      const nockScope = nock(dummyUrl)
        .get('/')
        .reply(500, {})
        .get('/')
        .reply(502, {})
        .get('/')
        .reply(501, {})
        .get('/')
        .reply(500, {})

      const apiRequest = new APIRequest(dummyUrl)
      await apiRequest.execute({
        baseAttemptDelay: 1
      })

      expect(nockScope.isDone()).toBe(true)
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
 