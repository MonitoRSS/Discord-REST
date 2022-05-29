import RESTConsumer from "./RESTConsumer"

describe('RESTConsumer', () => {
  let consumer: RESTConsumer;

  beforeEach(() => {
    consumer = new RESTConsumer('uri', {
      authHeader: 'header',
      clientId: 'client-id',
      checkIsDuplicate: async () => false
    })
  })

  describe('validateMessage', () => {
    it('should throw an error if the message is not JSON', async () => {
      const message = 'string'

      await expect(consumer.validateMessage(message as never)).rejects.toThrow(Error)
    })

    it.each([
      {route: 'route', options: {headers: {}}, meta: {}, startTimestamp: 1},
      {id: 'id', options: {headers: {}}, meta: {}, startTimestamp: 1},
    ])('should throw an error if the json does not match the expected shape %o', async (json) => {
      const message = {
        content: {
          toString: () => JSON.stringify(json)
        }
      }

      await expect(consumer.validateMessage(message as never)).rejects.toThrow(Error)
    })

    it.each([
      {id: 'id', route: 'route', options: {headers: {}}, meta: {}, body: {}, rpc: false, startTimestamp: 1},
      {id: 'id', route: 'route', options: {headers: {}}, meta: {}, body: {}, startTimestamp: 1},
      {id: 'id', route: 'route', options: {headers: {
        random: 'header'
      }, startTimestamp: 1}, meta: {}, body: {}, rpc: true, startTimestamp: 1},

    ])('should return the job data if the json matches the expected shape', async (json) => {
      const message = {
        content: {
          toString: () => JSON.stringify(json)
        }
      }

      await expect(consumer.validateMessage(message as never)).resolves.toEqual(json)
    })
  })
})
