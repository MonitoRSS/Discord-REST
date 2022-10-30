import { JobData, JobResponse, JobResponseError } from './RESTConsumer'
import { nanoid } from 'nanoid'
import { getQueueConfig, getQueueName, getQueueRPCReplyName } from './constants/queue-configs';
import { QUEUE_PRIORITY } from './constants/queue-priority';
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import EventEmitter from 'events';
import { BrokerAsPromised } from 'rascal'

dayjs.extend(utc)

interface Options {
  clientId: string;
  /**
   * Automatically delete all queues after all messages has been consumed. This is for
   * integration testing.
   */
  autoDeleteQueues?: boolean
}


interface RequestOptions {
  rpc?: boolean
  priority?: QUEUE_PRIORITY
  method?: string;
  body?: string
  headers?: Record<string, string>
}

declare interface RESTProducer {
  emit(event: 'error', err: Error): boolean
  on(event: 'error', listener: (err: Error) => void): this
}

class RESTProducer extends EventEmitter {
  broker: BrokerAsPromised | null = null;

  constructor(
    private readonly rabbitmqUri: string,
    private readonly options: Options
  ) {
    super()
  }

  public async initialize(): Promise<void> {
    const queueName = getQueueName(this.options.clientId)
    const rpcReplyName = getQueueRPCReplyName(this.options.clientId)

    this.broker = await BrokerAsPromised.create({
      vhosts: {
        v1: {
          connection: {
            url: this.rabbitmqUri,
          },
          // @ts-ignore
          queues: {
            [queueName]: {
              assert: true,
              options: getQueueConfig({
                autoDeleteQueues: this.options.autoDeleteQueues || false,
              }),
            },
            [rpcReplyName]: {
              assert: true,
              options: {
                autoDelete: true,
                exclusive: true,
                durable: false,
                arguments: {
                  'x-expires': 1000 * 60 * 5 // 5 minutes
                }
              }
            }
          },
          subscriptions: {
            [rpcReplyName]: {
              vhost: 'v1',
              queue: rpcReplyName,
              options: {
                noAck: true,
              },
              // @ts-ignore
              closeTimeout: 1000 * 60 * 2 // 2 minutes,
            },
          },
          publications: {
            [queueName]: {
              vhost: 'v1',
              queue: queueName,
            },
          }
        },
      },
    }, )

    this.broker.on('error', this.onErrorHandler)
  }

  public async onErrorHandler(err: Error): Promise<void> {
    this.emit('error', err)
  }

  public async close(): Promise<void> {
    if (!this.broker) {
      return
    }

    await this.broker.shutdown()
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

    if (!this.broker) {
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

    const publication = await this.broker.publish(getQueueName(this.options.clientId), Buffer.from(JSON.stringify(jobData)), {
      options: {
        deliveryMode: 2,
        priority: options.priority || QUEUE_PRIORITY.LOW,
      },
    })

    publication.on('error', this.onErrorHandler)
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

    if (!this.broker) {
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

    const subscriber = await this.broker.subscribe(getQueueRPCReplyName(this.options.clientId))
    subscriber.on('error', this.onErrorHandler)

    const response = new Promise<JobResponse<JSONResponse>>(async (resolve, reject) => {
      subscriber.on('message', (message, subscription) => {
        if (message.properties.correlationId !== jobData.id) {
          return
        }

        try {
          const parsedJson = JSON.parse(message.content.toString())
          resolve(parsedJson)
        } catch (err) {
          reject(new Error('Failed to parse JSON from RPC response'))
        }
      })
    })

    const publisher = await this.broker.publish(getQueueName(this.options.clientId), Buffer.from(JSON.stringify(jobData)), {
      options: {
        deliveryMode: 2,
        replyTo: getQueueRPCReplyName(this.options.clientId),
        correlationId: jobData.id,
        priority: QUEUE_PRIORITY.HIGH
      },
    })
    publisher.on('error', this.onErrorHandler)

    console.log('awiating res')
    const finalRes = await response
    console.log(finalRes)
    try {
      await subscriber.cancel()
    } catch (err) {
      this.emit('error', err as Error)
    }
    
    return finalRes
  }
}

export default RESTProducer
