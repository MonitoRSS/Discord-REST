import { RateLimit } from 'async-sema'
import fastq from 'fastq';

interface Options {
  maxPerSecond: number
}

export class RateLimitedQueue<Input, Response> {
  ratelimit: ReturnType<typeof RateLimit>
  queue: fastq.queue<Input, Response>
  isPaused = false

  constructor(
    private readonly worker: (item: Input) => Promise<Response>,
    private readonly options: Options
  ) {
    this.ratelimit = RateLimit(options.maxPerSecond)
    
    const wrappedWorker = async (item: Input) => {
      await this.ratelimit()
      return await this.worker(item)
    }

    this.queue = fastq<never, Input, Response>(wrappedWorker, 5000)
  }

  add(item: Input): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this.queue.push(item, (err, result) => {
        if (err) {
          reject(err)
          return
        } 
        
        if (!result) {
          reject(new Error('No result returned from job'))
          return
        }

        resolve(result)
      })
    })
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
