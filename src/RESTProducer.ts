import { JobData, JobResponse, JobResponseError } from './RESTConsumer'
import { nanoid } from 'nanoid'
import amqp from 'amqplib'
import { getQueueConfig, getQueueName, getQueueRPCReplyName } from './constants/queue-configs';
import { QUEUE_PRIORITY } from './constants/queue-priority';
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import EventEmitter from 'events';

dayjs.extend(utc)

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
  priority?: QUEUE_PRIORITY
}

declare interface RESTProducer {
  emit(event: 'error', err: Error): boolean
  on(event: 'error', listener: (err: Error) => void): this
}

class RESTProducer extends EventEmitter {
  private rabbitmq: {
    connection: amqp.Connection,
    channel: amqp.Channel,
  } | null = null;

  constructor(
    private readonly rabbitmqUri: string,
    private readonly options: Options
  ) {
    super()
  }

  public async initialize(): Promise<void> {
    // const amqpClient = // new AMQPClient(this.rabbitmqUri)
    const connection = await amqp.connect(this.rabbitmqUri)
    const channel = await connection.createChannel()
    await channel.assertQueue(getQueueName(this.options.clientId), getQueueConfig({
      autoDeleteQueues: this.options.autoDeleteQueues || false
    }))

    connection.once('error', this.onErrorHandler)
    channel.once('error', this.onErrorHandler)

    this.rabbitmq = {
      channel,
      connection,
    }
  }

  public async onErrorHandler(err: Error): Promise<void> {
    this.emit('error', err)

    try {
      await this.close()

      this.rabbitmq?.connection.removeListener('error', this.onErrorHandler)
      this.rabbitmq?.channel.removeListener('error', this.onErrorHandler)
      
      await this.initialize()
    } catch (err) {
      this.emit('error', new Error(`Failed to reinitialize RESTProducer after error: ${(err as Error).message}`))
    }
  }

  public async close(): Promise<void> {
    if (!this.rabbitmq) {
      return
    }
  
    await this.rabbitmq.channel.close()
    await this.rabbitmq.connection.close()
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
      startTimestamp: dayjs().valueOf()
    }

    await this.rabbitmq.channel.sendToQueue(
      getQueueName(this.options.clientId),
      Buffer.from(JSON.stringify(jobData)),
      {
        deliveryMode: 2,
        priority: options.priority || QUEUE_PRIORITY.LOW,
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
      startTimestamp: dayjs().utc().valueOf()
    }

    const replyQueue = await rabbitmq.channel.assertQueue(getQueueRPCReplyName(this.options.clientId), {
      autoDelete: true,
      exclusive: true,
      durable: false,
      arguments: {
        'x-expires': 1000 * 60 * 5 // 5 minutes
      }
    })

    let consumerTag: string | null = null
  
    const response = new Promise<JobResponse<JSONResponse>>(async (resolve, reject) => {
      try {
        const consumer = await rabbitmq.channel.consume(replyQueue.queue, async (message) => {
          
          if (!message || message.properties.correlationId !== jobData.id) {
            return
          }

          try {
            const parsedJson = JSON.parse(message.content.toString())
            resolve(parsedJson)
          } catch (err) {
            reject(new Error('Failed to parse JSON from RPC response'))
          }
        }, {
          noAck: true
        })

        consumerTag = consumer.consumerTag
      } catch (err) {
        reject(err)
      }
    })

    await rabbitmq.channel.sendToQueue(getQueueName(this.options.clientId), Buffer.from(JSON.stringify(jobData)), {
      deliveryMode: 2,
      replyTo: replyQueue.queue,
      correlationId: jobData.id,
      priority: QUEUE_PRIORITY.HIGH,
    })

    const finalRes = await response
    
    if (consumerTag) {
      rabbitmq.channel.cancel(consumerTag)
    }
    
    return finalRes
  }
}

export default RESTProducer
