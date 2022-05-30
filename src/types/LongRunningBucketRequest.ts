export interface LongRunningBucketRequest {
  executedApiRequest: boolean
  bucketQueueLength: number
  bucketBlockedUntil: Date | null
  bucketId: string
}
