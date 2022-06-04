import RESTHandler, { RESTHandlerOptions } from "./RESTHandler";
import { EventEmitter } from "events";
import { MessageParseError, RequestTimeoutError } from "./errors";
import * as yup from 'yup'
import amqp from 'amqplib'
import { getQueueConfig, getQueueName } from "./constants/queue-configs";
import { GLOBAL_BLOCK_TYPE } from "./constants/global-block-type";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc'
import { FetchResponse } from "./types/FetchResponse";
import { LongRunningBucketRequest } from "./types/LongRunningBucketRequest";
import { LongRunningHandlerRequest } from "./types/LongRunningHandlerRequest";
dayjs.extend(utc)

interface ConsumerOptions {
  /**
   * The value that will be in the Authorization header of every request.
   */
  authHeader: string;
  /**
   * The Discord bot's ID.
   */
  clientId: string;
  /**
   * Prior to processing a message, use this function to check if it's already been processed.
   * This is optional since in RPC, we don't care about checking for duplicates
   */
  checkIsDuplicate?: (jobId: string) => Promise<boolean>
  /**
   * Automatically delete all queues after all messages has been consumed. This is for
   * integration testing.
   */
  autoDeleteQueues?: boolean
  /**
   * Auto reject jobs after a duration, which also acknowledges the RabbitMQ message. These
   * jobs will emit a "jobError" event
   */
  rejectJobsAfterDurationMs?: number
}

interface RequestOptions extends RequestInit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const jobDataSchema = yup.object().required().shape({
  id: yup.string().required(),
  route: yup.string().required(),
  options: yup.object<yup.AnyObject, RequestOptions>().required(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: yup.object<yup.AnyObject, Record<string, any>>().shape({}).optional(),
  rpc: yup.boolean().optional(),
  startTimestamp: yup.number().required()
})

export type JobData = yup.InferType<typeof jobDataSchema>

export type JobResponse<DiscordResponse> = {
  state: 'success',
  status: number,
  body: DiscordResponse
}

export interface JobResponseError {
  state: 'error'
  message: string
}


declare interface RESTConsumer {
  emit(event: 'globalBlock', blockType: GLOBAL_BLOCK_TYPE, blockedDurationMs: number, debugDetails?: Record<string, any>): boolean
  emit(event: 'globalRestore', blockType: GLOBAL_BLOCK_TYPE): boolean
  emit(event: 'jobError', error: Error | RequestTimeoutError, job: JobData): boolean
  emit(event: 'err', error: Error): boolean
  emit(event: 'idle'|'active'): boolean
  emit(event: 'jobCompleted', job: JobData, result: JobResponse<Record<string, unknown>>): boolean
  emit(event: 'LongRunningBucketRequest', details: LongRunningBucketRequest): boolean
  emit(event: 'longRunningHandlerRequest', details: LongRunningHandlerRequest): boolean
  emit(event: 'next', queueSize: number, pending: number): boolean
  on(event: 'globalBlock', listener: (blockType: GLOBAL_BLOCK_TYPE, blockedDurationMs: number, debugDetails?: Record<string, any>) => void): this
  on(event: 'globalRestore', listener: (blockType: GLOBAL_BLOCK_TYPE) => void): this
  on(event: 'jobError', listener: (err: Error | RequestTimeoutError, job: JobData) => void): this
  on(event: 'err', listener: (err: Error) => void): this
  on(event: 'idle'|'active', listener: () => void): this
  on(event: 'jobCompleted', listener: (job: JobData, result: JobResponse<Record<string, unknown>>) => void): this
  on(event: 'LongRunningBucketRequest', listener: (details: LongRunningBucketRequest) => void): this
  on(event: 'LongRunningHandlerRequest', listener: (details: LongRunningHandlerRequest) => void): this
  on(event: 'next', listener: (queueSize: number, pending: number) => void): this
}

/**
 * Used to consume and enqueue Discord API requests. There should only ever be one consumer that's
 * executing requests across all services for proper rate limit handling.
 * 
 * For sending API requests to the consumer, the RESTProducer should be used instead.
 */
class RESTConsumer extends EventEmitter {
  /**
   * The handler that will actually run the API requests.
   */
  public handler: RESTHandler | null = null

  private rabbitmq: {
    connection: amqp.Connection,
    channel: amqp.Channel,
    consumerTag?: string
  } | null = null;

  constructor(
    /**
     * The RabbitMQ URI for the queue handler.
     */
    private readonly rabbitmqUri: string,
    private readonly consumerOptions: ConsumerOptions,
    private readonly options?: RESTHandlerOptions
  ) {
    super()
  }

  async initialize(): Promise<void> {
    this.handler = new RESTHandler({
      ...this.options,
      /**
       * Messages should re-enter the queue if we encounter a global block, so don't execute them
       * later on in this consumer, otherwise articles would be significantly delayed.
       */
      clearQueueAfterGlobalBlock: true
    })

    this.handler.on('globalBlock', (blockType, durationMs, debugDetails) => {
      if (blockType !== GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT) {
        /**
         * We should only stop the consumer if the global block is a cloudflare rate limit. Cloudflare
         * bans are IP-based, and we can switch to another consumer in that case. Other rate limits
         * can be gracefully handled after waiting a shorter amount of time within the same consumer.
         */
        return;
      }

      this.emit('globalBlock', blockType, durationMs, debugDetails)
      this.stopConsumer()
    })

    this.handler.on('globalRestore', (blockType) => {
      this.emit('globalRestore', blockType)
      this.startConsumer()
    })

    this.handler.on('LongRunningBucketRequest', (details) => {
      this.emit('LongRunningBucketRequest', details)
    })

    this.handler.on('next', (queueSize, pending) => {
      this.emit('next', queueSize, pending)
    })

    this.handler.on('idle', () => {
      this.emit('idle')
    })

    await this.establishConnection()
    await this.startConsumer()
  }

  async close(): Promise<void> {
    if (!this.rabbitmq) {
      return
    }

    if (this.rabbitmq.consumerTag) {
      await this.rabbitmq.channel.cancel(this.rabbitmq.consumerTag)
    }
    this.rabbitmq.channel.removeListener('error', this.onConnectionError)
    await this.rabbitmq.channel.close()
    this.rabbitmq.connection.removeListener('error', this.onConnectionError)
    await this.rabbitmq.connection.close()
  }

  async validateMessage(message: amqp.Message): Promise<JobData> {
    const json = JSON.parse(message.content.toString())
    return await jobDataSchema.validate(json)
  }

  private async startConsumer() {
    if (!this.rabbitmq) {
      throw new Error('Cannot start consumer when consumer is not initialized')
    }

    if (this.rabbitmq.consumerTag) {
      // The consumer is already active - there may be conditions where multiple blocks are happening

      return
    }
    
    const channel = this.rabbitmq.channel
    const queueName = getQueueName(this.consumerOptions.clientId)

    const consumer = await channel.consume(queueName, async (message) => {
      let data: JobData;

      if (!message) {
        return
      }
        
      try {
        data = await this.validateMessage(message)
      } catch (err) {
        this.emit('err', new MessageParseError(`Message validation failed: ${(err as Error).message}. Ensure job schemas of both producer and consumer are compatible with each other. Ignoring job execution.`))
        channel.ack(message)

        return;
      }

      if (await this.consumerOptions.checkIsDuplicate?.(data.id)) {
        channel.ack(message)

        return
      }
  
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let response: JobResponseError | JobResponse<any>;
      
      try {
        response = {
          ...await this.processJobData(data),
          state: 'success',
        }

        this.emit('jobCompleted', data, response)
      } catch (err) {
        const message = (err as Error).message
        response = {
          state: 'error',
          message
        }
        this.emit('jobError', err as Error, data)
      }


      if (data.rpc) {
        try {
          await channel.sendToQueue(message.properties.replyTo, Buffer.from(JSON.stringify(response)), {
            correlationId: message.properties.correlationId,
          })
        } catch (err) {
          this.emit('err', new Error(`Failed to send RPC response message: ${(err as Error).message}`))
        }
      }

      channel.ack(message)
    }, { noAck: false })

    this.rabbitmq.consumerTag = consumer.consumerTag
  }

  private async stopConsumer() {
    if (!this.rabbitmq) {
      throw new Error('RabbitMQ not initialized. Initialize the consumer first.')
    }

    if (!this.rabbitmq.consumerTag) {
      // The consumer is already stopped

      return
    }

    await this.rabbitmq.channel.cancel(this.rabbitmq.consumerTag)
    this.rabbitmq.consumerTag = undefined
  }

  private async restartConnection() {
    await this.close()
    await this.establishConnection()
  }

  private async establishConnection() {
    const connection = await amqp.connect(this.rabbitmqUri)
    const channel = await connection.createChannel()
    const queueName = getQueueName(this.consumerOptions.clientId)
    await channel.assertQueue(queueName, getQueueConfig({
      autoDeleteQueues: this.consumerOptions.autoDeleteQueues || false
    }))

    connection.once('error', this.onConnectionError)
    channel.once('error', this.onConnectionError)

    this.rabbitmq = {
      channel,
      connection,
    }
  }
  
  private async onConnectionError(error: Error) {
    this.emit('err', new Error(`RabbitMQ connection or channel error: ${(error as Error).message}. Restarting connection.`))
    await this.restartConnection()
  }

  private async processJobData(data: JobData) {
    const handler = this.handler
    if (!handler) {
      throw new Error('Handler not initialized')
    }

    return new Promise<{status: number, body: Record<string, never>}>(async (resolve, reject) => {
      const { rejectJobsAfterDurationMs } = this.consumerOptions
      try {
        const debugHistory: string[] = []
        let fetchTimeout: NodeJS.Timeout | null = null

        if (rejectJobsAfterDurationMs) {
          fetchTimeout = setTimeout(() => {
            reject(new Error(`Request processing took longer than ${rejectJobsAfterDurationMs}ms (debugHistory: ${JSON.stringify(debugHistory)})`))
          }, rejectJobsAfterDurationMs)
        }

        const res = await handler.fetch(data.route, {
          ...data.options,
          debugHistory,
          headers: {
            Authorization: this.consumerOptions.authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...data.options.headers,
          }
        })

        if (fetchTimeout) {
          clearTimeout(fetchTimeout)
        }

        const parsedData = await this.handleJobFetchResponse(res)

        resolve(parsedData)
      } catch (err) {
        reject(err)
      }
    })
  }

  private async handleJobFetchResponse(res: FetchResponse) {
    // A custom object be returned here to provide a serializable object to store
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any

    if (res.status === 204) {
      body = null
    } else if (res.headers['content-type']?.includes('application/json')) {
      body = await res.json()
    } else {
      body = await res.text()
    }

    return {
      status: res.status,
      body
    }
  }
}

export default RESTConsumer
