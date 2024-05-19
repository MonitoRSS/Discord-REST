import { JobData, JobResponse, JobResponseError } from './RESTConsumer'
import { nanoid } from 'nanoid'
import { AMQP_RPC_CALLBACK_QUEUE, getQueueConfig, getQueueName, getQueueRPCReplyName } from './constants/queue-configs';
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
  rpcReplyEmitter = new EventEmitter()

  constructor(
    private readonly rabbitmqUri: string,
    private readonly options: Options
  ) {
    super()
    const clientId = this.options.clientId
    const queueName = getQueueName(clientId)
    this.rpcReplyEmitter.setMaxListeners(0)
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

    this.channelWrapper.consume(AMQP_RPC_CALLBACK_QUEUE, async (message) => {
      if (!message) {
        return
      }

      const response: JobResponse<unknown> | JobResponseError = JSON.parse(message.content.toString())
      this.rpcReplyEmitter.emit(message.properties.correlationId, response)
    }, {
      noAck: true
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
    await this.connection.close()
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

    await this.channelWrapper.sendToQueue(rpcQueueName, Buffer.from(JSON.stringify(jobData)), {
      deliveryMode: 2,
      replyTo: AMQP_RPC_CALLBACK_QUEUE,
      correlationId: jobData.id,
      priority: QUEUE_PRIORITY.HIGH,
    })

    return new Promise((resolve) => {
      this.rpcReplyEmitter.once(jobData.id, (response: JobResponse<JSONResponse> | JobResponseError) => {
        resolve(response)
      })
    })
  }
}

export default RESTProducer
