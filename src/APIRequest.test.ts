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
      expect(apiRequest1.id).toEqual(1)
      expect(apiRequest2.id).toEqual(2)
      expect(apiRequest3.id).toEqual(3)
      expect(APIRequest.lastId).toEqual(3)
    })
    it('stores route and options', () => {
      const options = { method: 'GET', headers: { foo: 'bar' } }
      const apiRequest = new APIRequest('https://discord.com/api/v10/channels/123', options)
      expect(apiRequest.route).toEqual('https://discord.com/api/v10/channels/123')
      expect(apiRequest.options).toEqual(options)
    })
  })
  describe('toString', () => {
    it('returns a string with the route and id', () => {
      const apiRequest = new APIRequest('https://discord.com/api/v10/channels/123')
      const result = apiRequest.toString()
      expect(result).toEqual('https://discord.com/api/v10/channels/123 (#1)')
    })
  })
})
