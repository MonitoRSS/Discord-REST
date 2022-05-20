import RESTHandler, { RESTHandlerOptions } from "./RESTHandler";
import { Response } from "node-fetch";
import { EventEmitter } from "events";
import { AMQPChannel, AMQPClient, AMQPConsumer, AMQPMessage } from "@cloudamqp/amqp-client";
import { MessageParseError, MessageProcessingError } from "./errors";
import { AMQPBaseClient } from "@cloudamqp/amqp-client/types/amqp-base-client";
import * as yup from 'yup'

interface ConsumerOptions {
  /**
   * The value that will be in the Authorization header of every request.
   */
  authHeader: string;
  /**
   * The Discord bot's ID.
   */
  clientId: string;
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
  status: number,
  body: DiscordResponse
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
    connection: AMQPBaseClient,
    channel: AMQPChannel,
    consumer: AMQPConsumer
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
    const amqpClient = new AMQPClient(this.rabbitmqUri)
    this.handler = new RESTHandler(this.options)
    const connection = await amqpClient.connect()
    const channel = await connection.channel()
    const queue = await channel.queue(`discord-messages-${this.consumerOptions.clientId}`, {
      durable: true,
    }, {
      'x-single-active-consumer': true,
      'x-max-priority': 255,
      'x-queue-mode': 'lazy',
      'x-message-ttl': 1000 * 60 * 60 * 24 // 1 day
    })

    const consumer = await queue.subscribe({ noAck: false }, async (message) => {
      try {
        let data: JobData;
        
        try {
          data = await this.validateMessage(message)
        } catch (err) {
          this.emit('error', new MessageParseError((err as Error).message))

          return;
        }

        const response = await this.processJobData(data);
        
        if (data.rpc) {
          const callbackQueue = await channel.queue(message.properties.replyTo, {
            autoDelete: true,
          }, {
            'x-expires': 1000 * 60 * 5 // 5 minutes
          })

          await callbackQueue.publish(JSON.stringify(response), {
            correlationId: message.properties.correlationId,
          })
        }
      } catch (err) {
        this.emit('error', new MessageProcessingError((err as Error).message).message)        
      } finally {
        await message.ack()
      }
    })

    this.rabbitmq = {
      channel,
      connection,
      consumer
    }
  }

  async close(): Promise<void> {
    await this.rabbitmq?.consumer.cancel()
    await this.rabbitmq?.consumer.wait()
    await this.rabbitmq?.connection.close()
  }

  async validateMessage(message: AMQPMessage): Promise<JobData> {
    const json = JSON.parse(message.bodyToString() || '')
    return await jobDataSchema.validate(json)
  }

  private async processJobData(data: JobData) {
    const handler = this.handler
    if (!handler) {
      throw new Error('Handler not initialized')
    }

    return new Promise<{status: number, body: Record<string, never>}>(async (resolve, reject) => {
      try {
        // Timeout after 5 minutes
        const timeout = setTimeout(() => {
          this.emit('timeout', data)
          reject(new Error('Timed Out'))
        }, 1000 * 60 * 5)

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

  private async handleJobFetchResponse(res: Response) {
    if (res.status.toString().startsWith('5')) {
      throw new Error(`Bad status code (${res.status})`)
    }

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
