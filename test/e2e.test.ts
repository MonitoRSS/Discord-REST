import RESTConsumer from "../src/RESTConsumer";
import RESTProducer from "../src/RESTProducer";
import nock from 'nock'

const fallbackUri = 'amqp://localhost:5672';
const RABBITMQ_URI = process.env.RABBITMQ_URI || fallbackUri;

describe('e2e test', () => {
  let consumer: RESTConsumer;
  let producer: RESTProducer;
  const clientId = 'test:client-id'
  const route = 'https://example.com/messages'

  beforeAll(async () => {
    if (!RABBITMQ_URI) {
      throw new Error('process.env.RABBITMQ_URI is not set');
    }

    consumer = new RESTConsumer(RABBITMQ_URI, {
      authHeader: 'header',
      clientId,
      autoDeleteQueues: true,
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
    nock.cleanAll()
  })

  describe('producer', () => {
    describe('fetch', () => {
      it('returns the correct properties on successful fetch', async () =>{ 
        const apiResponse = {
          foo: 'bar'
        }
        nock('https://example.com')
          .get('/messages')
          .reply(200, apiResponse)
    
        const result = await producer.fetch(route)
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
        nock('https://example.com')
          .get('/messages')
          .reply(apiStatus, apiResponse)
          .persist()
    
        const result = await producer.fetch(route)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          // If needed for typescript to infer the types
          expect(result.body).toEqual(apiResponse)
          expect(result.status).toEqual(apiStatus)
        }
      })

      it('returns the correct properties on a status code 204', async () => {
        const apiStatus = 204
        nock('https://example.com')
          .get('/messages')
          .reply(apiStatus)
    
        const result = await producer.fetch(route)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          expect(result.body).toEqual(null)
          expect(result.status).toEqual(apiStatus)
        }
      })

      it('returns if content is not json', async () => {
        const apiStatus = 400
        const apiResponse = 'text here'
        nock('https://example.com')
          .get('/messages')
          .reply(apiStatus, apiResponse)
    
        const result = await producer.fetch(route)
        expect(result.state).toEqual('success')

        if (result.state === 'success') {
          expect(result.body).toEqual(apiResponse)
          expect(result.status).toEqual(apiStatus)
        }
      })

      it('returns with error if fetch failed', async () => {
        const apiResponse = 'text here'
        nock('https://example.com')
          .get('/messages')
          .replyWithError(apiResponse)
          .persist()
    
        const result = await producer.fetch(route)
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
