import RESTHandler, { RESTHandlerOptions } from "./RESTHandler";
import { EventEmitter } from "events";
import { MessageParseError, MessageProcessingError, RequestTimeoutError } from "./errors";
import * as yup from 'yup'
import amqp from 'amqplib'
import { getQueueConfig, getQueueName } from "./constants/queue-configs";

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
  rpc: yup.boolean().optional()
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
    consumerTag: string;
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
    this.handler = new RESTHandler(this.options)
    const connection = await amqp.connect(this.rabbitmqUri)
    const channel = await connection.createChannel()
    const queueName = getQueueName(this.consumerOptions.clientId)
    await channel.assertQueue(queueName, getQueueConfig({
      autoDeleteQueues: this.consumerOptions.autoDeleteQueues || false
    }))

    const consumer = await channel.consume(queueName, async (message) => {
      let data: JobData;

      if (!message) {
        return
      }
        
      try {
        data = await this.validateMessage(message)
      } catch (err) {
        this.emit('err', new MessageParseError((err as Error).message))
        channel.ack(message)

        return;
      }
  
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let response: JobResponseError | JobResponse<any>;
      
      try {
        response = {
          ...await this.processJobData(data),
          state: 'success',
        }
        
      } catch (err) {
        const message = (err as Error).message
        response = {
          state: 'error',
          message
        }
        if (err instanceof RequestTimeoutError) {
          this.emit('err', err, data)
        } else {
          this.emit('err', new MessageProcessingError(message), data)
        }
      }

      if (data.rpc) {
        await channel.sendToQueue(message.properties.replyTo, Buffer.from(JSON.stringify(response)), {
          correlationId: message.properties.correlationId,
        })
      }

      channel.ack(message)
    }, { noAck: false })    

    this.rabbitmq = {
      channel,
      connection,
      consumerTag: consumer.consumerTag
    }
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

  private async processJobData(data: JobData) {
    const handler = this.handler
    if (!handler) {
      throw new Error('Handler not initialized')
    }

    return new Promise<{status: number, body: Record<string, never>}>(async (resolve, reject) => {
      try {
        // Timeout after 4 minutes
        const timeout = setTimeout(() => {
          reject(new RequestTimeoutError())
        }, 1000 * 60 * 4)

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

        clearTimeout(timeout)

        resolve(parsedData)
      } catch (err) {
        reject(err)
      }
    })
  }

  private async handleJobFetchResponse(res: globalThis.Response) {
    // A custom object be returned here to provide a serializable object to store
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any

    if (res.status === 204) {
      body = null
    } else if (res.headers.get('Content-Type')?.includes('application/json')) {
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
