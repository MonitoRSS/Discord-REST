import Queue from "bull"
import { RequestInit } from "node-fetch"
import { JobData } from './RESTConsumer'

class RESTProducer {
  private redisUri: string
  private queue: Queue.Queue

  constructor(redisUri: string) {
    this.redisUri = redisUri
    this.queue = new Queue('discord-rest', this.redisUri)
  }

  /**
   * Fetch a resource from Discord's API. Requests are added to a Queue that a RESTConsumer
   * consumes.
   * 
   * @param route The full HTTP route string
   * @param options node-fetch options
   * @returns JSON response from Discord's API
   */
   public async enqueue<JSONResponse>(route: string, options: RequestInit): Promise<JSONResponse> {
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
    return job.finished()
  }
}

export default RESTProducer
