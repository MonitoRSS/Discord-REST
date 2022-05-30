export interface LongRunningHandlerRequest {
  executedApiRequest: boolean
  globalQueueLength: number
  globalBlockedUntil: Date | null
}
