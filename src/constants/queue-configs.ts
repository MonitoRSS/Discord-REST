import amqp from 'amqplib'

export const getQueueName = (clientId: string): string => {
  if (process.env.NODE_ENV === 'test') {
    return `test:discord-api-${clientId}`
  }
  
  return `discord-api-${clientId}`
}

export const getQueueRPCReplyName = (clientId: string): string => {
  if (process.env.NODE_ENV === 'test') {
    return `test:discord-api-reply-${clientId}`
  }
  
  return `discord-api-reply-${clientId}`
}

export const getQueueConfig = (options?: {
  autoDeleteQueues: boolean,
  singleActiveConsumer: boolean
}): amqp.Options.AssertQueue => {
  return {
    durable: true,
    autoDelete: options?.autoDeleteQueues,
    arguments: {
      'x-single-active-consumer': options?.singleActiveConsumer ?? true,
      'x-max-priority': 255,
      'x-queue-mode': 'lazy',
      'x-message-ttl': 1000 * 60 * 60 * 24 // 1 day
    }
  }
}