import RESTConsumer from "../src/RESTConsumer";
import RESTProducer from "../src/RESTProducer";
import { Interceptable, MockAgent, setGlobalDispatcher } from 'undici'

const fallbackUri = 'amqp://localhost:5672';
const RABBITMQ_URI = process.env.RABBITMQ_URI || fallbackUri;

describe('e2e test', () => {
  let consumer: RESTConsumer;
  let producer: RESTProducer;
  const clientId = 'test:client-id'
  const dummyHost = 'https://example.com'
  const dummyEndpoint = '/messages'
  const dummyUrl = dummyHost + dummyEndpoint
  let client: Interceptable
  const interceptDetails = {
    path: dummyEndpoint,
    method: 'GET',
  }

  beforeAll(async () => {
    if (!RABBITMQ_URI) {
      throw new Error('process.env.RABBITMQ_URI is not set');
    }

    consumer = new RESTConsumer(RABBITMQ_URI, {
      authHeader: 'header',
      clientId,
      autoDeleteQueues: true,
      checkIsDuplicate: async () => false
    });

    await consumer.initialize()
    producer = new RESTProducer(RABBITMQ_URI, {
      clientId,
      autoDeleteQueues: true,
    });
    await producer.initialize()
  })

  beforeEach(() => {
    jest.resetAllMocks()
    const agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)
    client = agent.get(dummyHost)
  })

  describe('producer', () => {
    describe('fetch', () => {
      it('returns the correct properties on successful fetch', async () =>{ 
        const apiResponse = {
          foo: 'bar'
        }
        client.intercept(interceptDetails).reply(200, apiResponse, {
          headers: {
            'content-type': 'application/json'
          }
        })

        const result = await producer.fetch(dummyUrl)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          expect(result.body).toEqual(apiResponse)
          expect(result.status).toEqual(200)
        }
      })

      it('returns the correct properties on non-200 fetch', async () => {
        const apiStatus = 400
        const apiResponse = {
          foo: 'bar'
        }
        client.intercept(interceptDetails).reply(apiStatus, apiResponse, {
          headers: {
            'content-type': 'application/json'
          }
        })

        const result = await producer.fetch(dummyUrl)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          // If needed for typescript to infer the types
          expect(result.body).toEqual(apiResponse)
          expect(result.status).toEqual(apiStatus)
        }
      })

      it('returns the correct properties on a status code 204', async () => {
        const apiStatus = 204
        client.intercept(interceptDetails).reply(apiStatus, {}, {
          headers: {
            'content-type': 'application/json'
          }
        })

        const result = await producer.fetch(dummyUrl)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          expect(result.body).toEqual(null)
          expect(result.status).toEqual(apiStatus)
        }
      })

      it('returns if content is not json', async () => {
        const apiStatus = 400
        const apiResponse = 'text here'
        client.intercept(interceptDetails).reply(apiStatus, apiResponse)

        const result = await producer.fetch(dummyUrl)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          expect(result.body).toEqual(apiResponse)
          expect(result.status).toEqual(apiStatus)
        }
      })

      it('returns with error if fetch failed', async () => {
        const apiResponse = new Error('text here')
        client.intercept(interceptDetails).replyWithError(apiResponse)

    
        const result = await producer.fetch(dummyUrl)
        expect(result.state).toEqual('error')

        if (result.state === 'error') {
          expect(result.message).toBeDefined()
        }
      })
    })
  })

  afterAll(async () => {
    await consumer?.close()
    await producer?.close()
  })
});
