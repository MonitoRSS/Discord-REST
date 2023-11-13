import { JobData, JobResponse, JobResponseError } from './RESTConsumer'
import { nanoid } from 'nanoid'
import { getQueueConfig, getQueueName, getQueueRPCReplyName } from './constants/queue-configs';
import { QUEUE_PRIORITY } from './constants/queue-priority';
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import EventEmitter from 'events';
import { RequestInit } from 'undici';
import amqp from 'amqp-connection-manager'
import { IAmqpConnectionManager } from 'amqp-connection-manager/dist/esm/AmqpConnectionManager';
import ChannelWrapper from 'amqp-connection-manager/dist/esm/ChannelWrapper';
import { Channel } from 'amqplib';

dayjs.extend(utc)

interface Options {
  clientId: string;
  /**
   * Automatically delete all queues after all messages has been consumed. This is for
   * integration testing.
   */
  autoDeleteQueues?: boolean
  singleActiveConsumer?: boolean
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
  connection: IAmqpConnectionManager;
  channelWrapper: ChannelWrapper;

  constructor(
    private readonly rabbitmqUri: string,
    private readonly options: Options
  ) {
    super()
    const queueName = getQueueName(this.options.clientId)
    
    this.connection = amqp.connect([rabbitmqUri])
    this.channelWrapper = this.connection.createChannel({
      setup: function (channel: Channel) {
        return channel.assertQueue(queueName, {
          ...getQueueConfig({
            autoDeleteQueues: options.autoDeleteQueues || false,
            singleActiveConsumer: options.singleActiveConsumer ?? true,
          }),
        })
      }
    })
  }

  public async initialize(): Promise<void> {
    // Leave empty for now
  }

  public async onErrorHandler(err: Error): Promise<void> {
    this.emit('error', err)
  }

  public async close(): Promise<void> {
    await this.channelWrapper.close()
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
  public async enqueue(route: string, options: RequestOptions = {}, meta?: Record<string, unknown> & {
    id?: string
  }): Promise<void> {
    if (!route) {
      throw new Error(`Missing route for RESTProducer enqueue`)
    }

    const jobData: JobData = {
      id: meta?.id || nanoid(),
      route,
      options,
      meta,
      rpc: false,
      startTimestamp: dayjs().valueOf()
    }

    await this.channelWrapper.sendToQueue(getQueueName(this.options.clientId), Buffer.from(JSON.stringify(jobData)), {
      deliveryMode: 2,
      priority: options.priority || QUEUE_PRIORITY.LOW,
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

    const jobData: JobData = {
      id: nanoid(),
      route,
      options,
      meta,
      rpc: true,
      startTimestamp: dayjs().utc().valueOf()
    }

    const rpcQueueName = getQueueRPCReplyName(this.options.clientId)

    await this.channelWrapper.addSetup(function (channel: Channel) {
      return Promise.all([
        channel.assertQueue(jobData.id, {
          exclusive: true,
          autoDelete: true,
          expires: 1000 * 60 * 1, // 1 minutes
          durable: false,
        })
      ])
    })

    let consumerTag: string;

    const response = new Promise<JobResponse<JSONResponse>>(async (resolve, reject) => {
      const consumer = await this.channelWrapper.consume(jobData.id, async (message) => {
        if (message.properties.correlationId !== jobData.id) {
          return
        }

        try {
          const parsedJson = JSON.parse(message.content.toString()) as JobResponse<JSONResponse>
          resolve(parsedJson)
        } catch (err) {
          reject(new Error('Failed to parse JSON from RPC response'))
        }
      }, {
        noAck: true,
      })
      
      consumerTag = consumer.consumerTag
    })
    
    await this.channelWrapper.sendToQueue(rpcQueueName, Buffer.from(JSON.stringify(jobData)), {
      deliveryMode: 2,
      replyTo: jobData.id,
      correlationId: jobData.id,
      priority: QUEUE_PRIORITY.HIGH,
    })

    const finalRes = await response

    try {
      // @ts-ignore
      await this.channelWrapper.cancel(consumerTag as string)
    } catch (err) {
      this.emit('error', err as Error)
    }
    
    return finalRes
  }
}

export default RESTProducer
