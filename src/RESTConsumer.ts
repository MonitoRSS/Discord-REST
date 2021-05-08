import RESTHandler, { RESTHandlerOptions } from "./RESTHandler";
import Queue from 'bull'
import { RequestInit, Response } from "node-fetch";

export type JobData = {
  route: string
  options: RequestInit
  meta?: Record<string, unknown>
}

export type JobResponse<DiscordResponse> = {
  status: number,
  body: DiscordResponse
}

export const REDIS_QUEUE_NAME = 'discord-rest'

/**
 * Used to consume and enqueue Discord API requests. There should only ever be one consumer that's
 * executing requests across all services for proper rate limit handling.
 * 
 * For sending API requests to the consumer, the RESTProducer should be used instead.
 */
class RESTConsumer {
  /**
   * The Redis URI for the queue handler.
   */
  private redisUri: string
  /**
   * The queue that handles requests to Discord API. Requests are delayed according to received
   * rate limits from Discord, and has concurrncy throttled to 20/sec.
   */
  public queue: Queue.Queue
  /**
   * The handler that will actually run the API requests.
   */
  public handler: RESTHandler
  /**
   * Timer used to coordinate when the queue is blocked and unblocked.
   */
  private queueBlockTimer: NodeJS.Timer|null = null;
  /**
   * The auth header that should be applied to all requests.
   */
  private authHeader: string;

  constructor(redisUri: string, authHeader: string, options?: RESTHandlerOptions) {
    this.redisUri = redisUri
    this.authHeader = authHeader
    this.handler = new RESTHandler(options)
    // 50/sec is the maximum limit suggested by Discord
    // https://discord.com/developers/docs/topics/rate-limits#global-rate-limit
    const maxRequestsPerSecond = options?.maxRequestsPerSecond || 50
    this.queue = new Queue(options?.queueName || REDIS_QUEUE_NAME, this.redisUri, {
      limiter: {
        max: maxRequestsPerSecond,
        duration: 1000
      }
    })
    this.queue.process(100, ({ data }: { data: JobData }) => {
      return this.handler.fetch(data.route, {
        ...data.options,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...data.options.headers,
        }
      }).then(this.handleJobFetchResponse)
    })
    this.handler.on('invalidRequestsThreshold', async () => {
      // Block everything for 10 min - a value given by Discord after a global limit threshold hit.
      await this.blockGloballyByDuration(1000 * 60 * 10)
    })
    this.handler.on('globalRateLimit', async (apiRequest, blockDurationMs) => {
      await this.blockGloballyByDuration(blockDurationMs)
    })
    this.handler.on('cloudflareLimit', async (apiRequest, blockDurationMs) => {
      await this.blockGloballyByDuration(blockDurationMs)
    })
  }

  private async handleJobFetchResponse(res: Response) {
    if (res.status.toString().startsWith('5')) {
      throw new Error(`Bad status code (${res.status})`)
    }

    // A custom object be returned here to provide a serializable object to store within Redis
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

  /**
   * Blocks all queued API requests and buckets for a duration
   * If there's already a timer, the previous timer is cleared
   * and is recreated
   */
  private async blockGloballyByDuration (durationMs: number) {
    this.handler.blockBucketsByDuration(durationMs)
    if (this.queueBlockTimer) {
      clearTimeout(this.queueBlockTimer)
    }
    // The pause/resumes should be local since there should only ever be 1 consumer running
    await this.queue.pause(true, true)
    this.queueBlockTimer = setTimeout(async () => {
      await this.queue.resume(true)
      this.queueBlockTimer = null
    }, durationMs)
  }
}

export default RESTConsumer
