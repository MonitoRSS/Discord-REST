import { ok } from "assert";
import { RESTProducer } from "../src";

const rabbitmqUri = process.env.RABBITMQ_URI
const clientId = process.env.DISCORD_CLIENT_ID
const channelId = process.env.DISCORD_CHANNEL_ID

ok(rabbitmqUri, "process.env.RABBITMQ_URI is required")
ok(clientId, "process.env.DISCORD_CLIENT_ID is required")
ok(channelId, "process.env.DISCORD_CHANNEL_ID is required")

const producer = new RESTProducer(rabbitmqUri, {
  clientId,
});

producer.initialize().then(async () => {
  console.log('Producer is initialized')

  await Promise.all(new Array(10).fill(0).map(function (_, index) {
    const nodeFetchOptions = {
      // node-fetch options.
      method: "POST",
      body: JSON.stringify({
        content: `hello world: ${index}`
      }),
    }


    return producer.enqueue(
      `https://discord.com/api/channels/${channelId}/messages`,
      nodeFetchOptions,
      {
        // Any meta info you'd like to attach to this request
        meta: 1,
      }
    )
  }))

  console.log('Sent all')

  // process.exit(0)
}).catch(err => {
  console.error(err)
  process.exit(1)
})
