import { ok } from "assert";
import { RESTConsumer } from "../src";

const rabbitmqUri = process.env.RABBITMQ_URI
const botToken = process.env.DISCORD_BOT_TOKEN
const clientId = process.env.DISCORD_CLIENT_ID

ok(rabbitmqUri, "process.env.RABBITMQ_URI is required")
ok(botToken, "process.env.DISCORD_BOT_TOKEN is required")
ok(clientId, "process.env.DISCORD_CLIENT_ID is required")

const consumer = new RESTConsumer(rabbitmqUri, {
  authHeader: `Bot ${botToken}`,
  clientId,
});

consumer.initialize()
.then(() => console.log('Initialized, waiting'))
.catch(err => {
  console.error(err)
  process.exit(1)
})