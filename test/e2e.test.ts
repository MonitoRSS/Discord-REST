import RESTConsumer from "../src/RESTConsumer";
import RESTProducer from "../src/RESTProducer";
import nock from 'nock'

const RABBITMQ_URI = process.env.RABBITMQ_URI as string;

describe('e2e test', () => {
  let consumer: RESTConsumer;
  let producer: RESTProducer;
  const clientId = 'client-id'

  beforeAll(() => {
    if (!RABBITMQ_URI) {
      throw new Error('process.env.RABBITMQ_URI is not set');
    }

    consumer = new RESTConsumer(RABBITMQ_URI, {
      authHeader: 'header',
      clientId
    });
    producer = new RESTProducer(RABBITMQ_URI, {
      clientId
    });
  })

  it('works', async () =>{ 
    expect(true).toEqual(true)
  })

  afterAll(async () => {
    await consumer?.close()
    await producer?.close()
  })
});
