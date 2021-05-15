import Queue, { Job } from "bull"
import { RequestInit } from "node-fetch"
import { JobData, JobResponse, REDIS_QUEUE_NAME } from './RESTConsumer'
import { RESTHandlerOptions } from "./RESTHandler"

class RESTProducer {
  private redisUri: string
  private queue: Queue.Queue

  constructor(redisUri: string, options?: Pick<RESTHandlerOptions, 'queueName'>) {
    this.redisUri = redisUri
    this.queue = new Queue(options?.queueName || REDIS_QUEUE_NAME, this.redisUri)
    /**
     * Set the relevant listeners to infinite max listeners to prevent this.fetch calls
     * creating event emitter warnings since it creates even emitters every time we need to wait
     * for a job to complete.
     */
    this.queue.setMaxListeners(0)
    // @ts-ignore
    this.queue.eclient.setMaxListeners(0)
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
  public async enqueue(route: string, options: RequestInit = {}, meta?: Record<string, unknown>): Promise<Job> {
    const jobData: JobData = {
      route,
      options,
      meta
    }
    const job = await this.queue.add(jobData, {
      removeOnComplete: true,
      removeOnFail: true,
      // Job failures should only happen when requests get stalled, or when requests timeout
      attempts: 3,
    })
    return job
  }

  /**
   * Fetch a resource from Discord's API.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @param meta Metadata to attach to the job for the Consumer to access
   * @returns Fetch response details
   */
  public async fetch<JSONResponse>(route: string, options: RequestInit = {}, meta?: Record<string, unknown>): Promise<JobResponse<JSONResponse>> {
    const job = await this.enqueue(route, options, meta)
    return new Promise((resolve) => {
      const jobCompleteFn = (jobId: string, result: JobResponse<JSONResponse>) => {
        console.log('job completed')
        if (jobId !== job.id) {
          return
        }
        resolve(result)
        this.queue.removeListener('global:completed', jobCompleteFn)
      }
      this.queue.on('global:completed', jobCompleteFn)
    })
  }
}

export default RESTProducer
