import Queue, { Job } from "bull"
import { RequestInit } from "node-fetch"
import { JobData, JobResponse } from './RESTConsumer'

class RESTProducer {
  private redisUri: string
  private queue: Queue.Queue

  constructor(redisUri: string) {
    this.redisUri = redisUri
    this.queue = new Queue('discord-rest', this.redisUri)
  }

  /**
   * Enqueue a request to Discord's API. If the API response is needed, the fetch method
   * should be used instead of enqueue.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @returns The enqueued job
   */
  public async enqueue(route: string, options: RequestInit): Promise<Job> {
    const jobData: JobData = {
      route,
      options
    }
    const job = await this.queue.add(jobData, {
      removeOnComplete: true,
      removeOnFail: true,
      // Attempts are handled by buckets
      attempts: 1,
    })
    return job
  }

  /**
   * Fetch a resource from Discord's API.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @returns Fetch response details
   */
  public async fetch<JSONResponse>(route: string, options: RequestInit): Promise<JobResponse<JSONResponse>> {
    const job = await this.enqueue(route, options)
    return job.finished();
  }
}

export default RESTProducer
