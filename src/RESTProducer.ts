import { AMQPChannel, AMQPClient, AMQPQueue } from "@cloudamqp/amqp-client"
import { AMQPBaseClient } from "@cloudamqp/amqp-client/types/amqp-base-client"
import { JobData, JobResponse, JobResponseError } from './RESTConsumer'
import { nanoid } from 'nanoid'

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
    connection: AMQPBaseClient,
    channel: AMQPChannel,
    queue: AMQPQueue
  } | null = null;

  constructor(
    private readonly rabbitmqUri: string,
    private readonly options: Options
  ) {}

  public async initialize(): Promise<void> {
    const amqpClient = new AMQPClient(this.rabbitmqUri)
    const connection = await amqpClient.connect()
    const channel = await connection.channel()
    const queue = await channel.queue(`discord-messages-${this.options.clientId}`, {
      durable: true,
      autoDelete: this.options.autoDeleteQueues,
    }, {
      'x-single-active-consumer': true,
      'x-max-priority': 255,
      'x-queue-mode': 'lazy',
      'x-message-ttl': 1000 * 60 * 60 * 24 // 1 day
    })

    this.rabbitmq = {
      channel,
      connection,
      queue,
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

    await this.rabbitmq.queue.publish(JSON.stringify(jobData), {
      deliveryMode: 2,
    })
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
      rpc: true,
    }

    const replyQueue = await this.rabbitmq.channel.queue(`discord-messages-callback-${jobData.id}`, {
      autoDelete: true,
    }, {
      'x-expires': 1000 * 60 * 5 // 5 minutes
    })
  
    const response = new Promise<JobResponse<JSONResponse>>(async (resolve, reject) => {
      try {
        const consumer = await replyQueue.subscribe({ noAck: true }, async (message) => {
          if (message.properties.correlationId !== jobData.id) {
            return
          }

          try {
            const parsedJson = JSON.parse(message.bodyToString() || '')
            resolve(parsedJson)
          } catch (err) {
            throw new Error('Failed to parse JSON from RPC response')
          } finally {
            await consumer.cancel()
          }
        })
      } catch (err) {
        reject(err)
      }
    })

    await this.rabbitmq.queue.publish(JSON.stringify(jobData), {
      deliveryMode: 2,
      replyTo: replyQueue.name,
      correlationId: jobData.id,
    })

    return response
  }
}

export default RESTProducer
