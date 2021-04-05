import Queue from 'bull';
import { BullAdapter, setQueues, router } from 'bull-board'
import { REDIS_QUEUE_NAME } from './RESTConsumer';
import express from 'express'

const app = express()

const queue = new Queue(REDIS_QUEUE_NAME)

app.use(router)

setQueues([
  new BullAdapter(queue)
])

const port = 3000

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})