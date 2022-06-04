import sem from 'semaphore'

interface Options {
  maxPerSecond: number
}

interface InputType {
  id: string|number
  debugHistory?: string[]
}

export class RateLimitedQueue<Input extends InputType, Response> {
  isPaused = false
  pendingItemIds: Set<string|number> = new Set()
  sem: sem.Semaphore
  totalSize = 0
  pendingSize = 0
  autoClearingInterval: NodeJS.Timeout | null = null

  constructor(
    private readonly worker: (item: Input) => Promise<Response>,
    private readonly options: Options
  ) {
    // this.ratelimit = RateLimit(options.maxPerSecond)
    this.sem = sem(options.maxPerSecond)

    if (process.env.NODE_ENV !== 'test') {
      this.autoClearingInterval = this.createAutoClearingInterval()
    }
  }

  add(item: Input): Promise<Response> {
    this.totalSize++
    item.debugHistory?.push('RLQ: Added item to rate limited queue')
    // const result = await this.queue.push(item)
    return new Promise<Response>((resolve, reject) => {
      this.sem.take(async () => {
        try {
          item.debugHistory?.push('RLQ: Starting worker')
          this.pendingSize++
          const result = await this.worker(item)
          resolve(result)
        } catch (err) {
          reject(err)
        } finally {
          this.totalSize--
          this.pendingSize--
        }
      })
    })
  }

  pause(): void {
    this.isPaused = true

    if (this.autoClearingInterval) {
      clearInterval(this.autoClearingInterval)
    }
    
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    this.sem.take(this.sem.capacity - this.sem.current, () => {})
  }

  resume(): void {
    this.isPaused = false
    this.sem.leave(this.sem.current)

    if (this.autoClearingInterval) {
      clearInterval(this.autoClearingInterval)
    }

    this.autoClearingInterval = this.createAutoClearingInterval()
  }
  
  start(): void {
    this.resume()
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  clear(): void {}

  get size(): number {
    return this.totalSize
  }

  get pending(): number {
    return this.pendingSize
  }

  private createAutoClearingInterval() {
    return setInterval(async () => {
      if (!this.sem.current) {
        return
      }
      this.sem.leave(this.sem.current)
    }, 1000)
  }
}
