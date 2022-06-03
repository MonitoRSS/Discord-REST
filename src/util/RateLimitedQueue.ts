import { RateLimit } from 'async-sema'
import fastq from 'fastq';
import type { queueAsPromised } from "fastq";

interface Options {
  maxPerSecond: number
}

export class RateLimitedQueue<Input, Response> {
  ratelimit: ReturnType<typeof RateLimit>
  queue: queueAsPromised<Input, Response>
  isPaused = false

  constructor(
    private readonly worker: (item: Input) => Promise<Response>,
    private readonly options: Options
  ) {
    this.ratelimit = RateLimit(options.maxPerSecond)
    
    const wrappedWorker = async (item: Input) => {
      await this.ratelimit()

      return this.worker(item)
    }

    this.queue = fastq.promise<never, Input, Response>(wrappedWorker, 5000)
  }

  async add(item: Input): Promise<Response> {
    const result = await this.queue.push(item)

    return result
  }

  pause(): void {
    this.isPaused = true
    this.queue.pause()
  }

  resume(): void {
    this.isPaused = false
    this.queue.resume()
  }
  
  start(): void {
    this.resume()
  }

  clear(): void {
    this.queue.kill()
  }

  get size(): number {
    return this.queue.length()
  }

  get pending(): number {
    return 0
  }
}
