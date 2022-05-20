import RESTConsumer from "./RESTConsumer"

describe('RESTConsumer', () => {
  describe('validateMessage', () => {
    it('should throw an error if the message is not JSON', async () => {
      const consumer = new RESTConsumer('uri', {
        authHeader: 'header',
        clientId: 'client-id'
      })

      const message = 'string'

      await expect(consumer.validateMessage(message as never)).rejects.toThrow(Error)
    })

    it.each([
      {route: 'route', options: {headers: {}}, meta: {}},
      {id: 'id', options: {headers: {}}, meta: {}},
    ])('should throw an error if the json does not match the expected shape %o', async (json) => {
      const consumer = new RESTConsumer('uri', {
        authHeader: 'header',
        clientId: 'client-id'
      })

      const message = {
        bodyToString: () => JSON.stringify(json)
      }

      await expect(consumer.validateMessage(message as never)).rejects.toThrow(Error)
    })

    it.each([
      {id: 'id', route: 'route', options: {headers: {}}, meta: {}, body: {}, rpc: false},
      {id: 'id', route: 'route', options: {headers: {}}, meta: {}, body: {}},
      {id: 'id', route: 'route', options: {headers: {
        random: 'header'
      }}, meta: {}, body: {}, rpc: true},

    ])('should return the job data if the json matches the expected shape', async (json) => {
      const consumer = new RESTConsumer('uri', {
        authHeader: 'header',
        clientId: 'client-id'
      })

      const message = {
        bodyToString: () => JSON.stringify(json)
      }

      await expect(consumer.validateMessage(message as never)).resolves.toEqual(json)
    })
  })
})
