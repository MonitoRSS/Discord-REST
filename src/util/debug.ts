import debug, { Debugger } from 'debug'

export const createBucketDebug = (bucketId: string): Debugger => {
  return debug(`discordrest:bucket:${bucketId}`)
}
