import { JobData, JobResponse, JobResponseError } from './RESTConsumer'
import { nanoid } from 'nanoid'
import amqp from 'amqplib'

interface Options {
  clientId: string;
  /**
   * Automatically delete all queues after all messages has been consumed. This is for
   * integration testing.
   */
  autoDeleteQueues?: boolean
}

interface RequestOptions extends RequestInit {
  rpc?: boolean
}

class RESTProducer {
  private rabbitmq: {
    connection: amqp.Connection,
    channel: amqp.Channel,
  } | null = null;

  constructor(
    private readonly rabbitmqUri: string,
    private readonly options: Options
  ) {}

  public async initialize(): Promise<void> {
    // const amqpClient = // new AMQPClient(this.rabbitmqUri)
    const connection = await amqp.connect(this.rabbitmqUri)
    const channel = await connection.createChannel()
    await channel.assertQueue(`discord-messages-${this.options.clientId}`, {
      durable: true,
      autoDelete: this.options.autoDeleteQueues,
      arguments: {
        'x-single-active-consumer': true,
        'x-max-priority': 255,
        'x-queue-mode': 'lazy',
        'x-message-ttl': 1000 * 60 * 60 * 24 // 1 day
      }
    })

    this.rabbitmq = {
      channel,
      connection,
    }
  }

  public async close(): Promise<void> {
    await this.rabbitmq?.connection.close()
  }

  /**
   * Enqueue a request to Discord's API. If the API response is needed, the fetch method
   * should be used instead of enqueue.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @param meta Metadata to attach to the job for the Consumer to access
   * @returns The enqueued job
   */
  public async enqueue(route: string, options: RequestOptions = {}, meta?: Record<string, unknown>): Promise<void> {
    if (!route) {
      throw new Error(`Missing route for RESTProducer enqueue`)
    }

    if (!this.rabbitmq) {
      throw new Error(`RESTProducer must be initialized with initialize() before enqueue`)
    }

    const jobData: JobData = {
      id: nanoid(),
      route,
      options,
      meta,
      rpc: false,
    }

    await this.rabbitmq.channel.sendToQueue(
      `discord-messages-${this.options.clientId}`,
      Buffer.from(JSON.stringify(jobData)),
      {
        deliveryMode: 2,
      }
    )

    // await this.rabbitmq.queue.publish(JSON.stringify(jobData), {
    //   deliveryMode: 2,
    // })
  }

  /**
   * Fetch a resource from Discord's API.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @param meta Metadata to attach to the job for the Consumer to access
   * @returns Fetch response details
   */
  public async fetch<JSONResponse>(
    route: string,
    options: RequestInit = {},
    meta?: Record<string, unknown>
  ): Promise<JobResponse<JSONResponse> | JobResponseError> {
    const rabbitmq = this.rabbitmq
    if (!route) {
      throw new Error(`Missing route for RESTProducer enqueue`)
    }

    if (!rabbitmq) {
      throw new Error(`RESTProducer must be initialized with initialize() before enqueue`)
    }

    const jobData: JobData = {
      id: nanoid(),
      route,
      options,
      meta,
      rpc: true,
    }

    const replyQueue = await rabbitmq.channel.assertQueue('', {
      autoDelete: true,
      exclusive: true,
      arguments: {
        'x-expires': 1000 * 60 * 5 // 5 minutes
      }
    })
  
    const response = new Promise<JobResponse<JSONResponse>>(async (resolve, reject) => {
      try {
        rabbitmq.channel.consume(replyQueue.queue, async (message) => {
          
          if (!message || message.properties.correlationId !== jobData.id) {
            return
          }

          try {
            const parsedJson = JSON.parse(message.content.toString())
            resolve(parsedJson)
          } catch (err) {
            throw new Error('Failed to parse JSON from RPC response')
          }
        }, {
          noAck: true
        })
      } catch (err) {
        reject(err)
      }
    })

    await rabbitmq.channel.sendToQueue(`discord-messages-${this.options.clientId}`, Buffer.from(JSON.stringify(jobData)), {
      deliveryMode: 2,
      replyTo: replyQueue.queue,
      correlationId: jobData.id,
    })

    return response
  }
}

export default RESTProducer
