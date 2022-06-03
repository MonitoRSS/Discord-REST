import { RateLimit } from 'async-sema'
import fastq from 'fastq';
import type { queueAsPromised } from "fastq";

interface Options {
  maxPerSecond: number
}

interface InputType {
  id: string|number
  debugHistory?: string[]
}

export class RateLimitedQueue<Input extends InputType, Response> {
  ratelimit: ReturnType<typeof RateLimit>
  queue: queueAsPromised<Input, Response>
  isPaused = false
  pendingItemIds: Set<string|number> = new Set()

  constructor(
    private readonly worker: (item: Input) => Promise<Response>,
    private readonly options: Options
  ) {
    this.ratelimit = RateLimit(options.maxPerSecond)
    
    const wrappedWorker = async (item: Input) => {
      item.debugHistory?.push('RLQ: Waiting for rate limit')
      await this.ratelimit()
      item.debugHistory?.push('RLQ: Starting work')

      return this.worker(item)
    }

    this.queue = fastq.promise<never, Input, Response>(wrappedWorker, 5000)
  }

  async add(item: Input): Promise<Response> {
    item.debugHistory?.push('RLQ: Added item to rate limited queue')
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
