import RESTHandler, { RESTHandlerOptions } from "./RESTHandler";
import { EventEmitter } from "events";
import { MessageParseError, MessageProcessingError, RequestTimeoutError } from "./errors";
import * as yup from 'yup'
import amqp from 'amqplib'
import { getQueueConfig, getQueueName } from "./constants/queue-configs";
import { GLOBAL_BLOCK_TYPE } from "./constants/global-block-type";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc'
import { FetchResponse } from "./types/FetchResponse";
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
  emit(event: 'globalBlock', blockType: GLOBAL_BLOCK_TYPE, blockedDurationMs: number): boolean
  emit(event: 'globalRestore', blockType: GLOBAL_BLOCK_TYPE): boolean
  emit(event: 'jobError', error: Error, job: JobData): boolean
  emit(event: 'err', error: Error): boolean
  emit(event: 'jobCompleted', job: JobData, result: JobResponse<Record<string, unknown>>): boolean
  on(event: 'globalBlock', listener: (blockType: GLOBAL_BLOCK_TYPE, blockedDurationMs: number) => void): this
  on(event: 'globalRestore', listener: (blockType: GLOBAL_BLOCK_TYPE) => void): this
  on(event: 'jobError', listener: (err: Error, job: JobData) => void): this
  on(event: 'err', listener: (err: Error) => void): this
  on(event: 'jobCompleted', listener: (job: JobData, result: JobResponse<Record<string, unknown>>) => void): this
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

    this.handler.on('globalBlock', (blockType, durationMs) => {
      if (blockType !== GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT) {
        /**
         * We should only stop the consumer if the global block is a cloudflare rate limit. Cloudflare
         * bans are IP-based, and we can switch to another consumer in that case. Other rate limits
         * can be gracefully handled after waiting a shorter amount of time within the same consumer.
         */
        return;
      }

      this.emit('globalBlock', blockType, durationMs)
      this.stopConsumer()
    })

    this.handler.on('globalRestore', (blockType) => {
      this.emit('globalRestore', blockType)
      this.startConsumer()
    })

    const connection = await amqp.connect(this.rabbitmqUri)
    const channel = await connection.createChannel()
    const queueName = getQueueName(this.consumerOptions.clientId)
    await channel.assertQueue(queueName, getQueueConfig({
      autoDeleteQueues: this.consumerOptions.autoDeleteQueues || false
    }))

    this.rabbitmq = {
      channel,
      connection,
    }

    await this.startConsumer()
  }

  async close(): Promise<void> {
    if (!this.rabbitmq) {
      return
    }

    await this.rabbitmq.channel.close()
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
        this.emit('jobError', new MessageProcessingError(`Failed to process job (${message})`), data)
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

  private async processJobData(data: JobData) {
    const handler = this.handler
    if (!handler) {
      throw new Error('Handler not initialized')
    }

    return new Promise<{status: number, body: Record<string, never>}>(async (resolve, reject) => {
      try {
        const res = await handler.fetch(data.route, {
          ...data.options,
          headers: {
            Authorization: this.consumerOptions.authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...data.options.headers,
          }
        })

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
