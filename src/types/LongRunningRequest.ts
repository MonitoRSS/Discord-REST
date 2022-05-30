export interface LongRunningRequestDetails {
  executedApiRequest: boolean
  bucketQueueLength: number
  bucketBlockedUntil: Date | null
  bucketId: string
}
