# Discord-REST

[node-fetch](https://github.com/node-fetch/node-fetch) wrapper meant to gracefully handle the frightening and confusing monster of Discord rate limits.

All requests are executed in order. The goal of this library is to minimize or completely avoid bucket ratelimits. The only rate limits you should be hitting are global ones since Discord does not provide information on global limits for preemptive actions until you actually hit one.

Requests are automatically timed out after 10s.

### Table of Contents
* [Usage](#usage)
* [Debugging](#debugging)
<!-- - [Excessive Rate Limit Handling](#failsafe) -->

## Usage
```ts
import { RESTHandler } from 'synzen/Discord-Rest'

// node-fetch arguments
handler.fetch('https://discord.com/api/channels/channelID/messages', {
  method: 'POST',
  body: JSON.stringify({
    content: 'abc'
  }),
  headers: {
    Authorization: `Bot ${process.env.BOT_TOKEN}`,
    // Specifically for JSON responses
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
})
.then(res => res.json())
.then(console.log)
.catch(console.error)
```
If you execute multiple requests asynchronously, for example:
```ts
for (let i = 0; i < 3; ++i) {
  executor.fetch('https://discord.com/api/channels/channelID/messages', {
    method: 'POST',
    body: JSON.stringify({
      content: i
    }),
    headers: {
      Authorization: `Bot ${process.env.BOT_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  })
  .then(() => console.log(i))
  .catch(console.error)
}
```
You will notice that they are executed in order with the output:

```shell
1
2
3
```
since they are all within the same rate limit bucket.

<!-- ## Excessive Rate Limit Handling

If you encounter to many rate limits, Discord will block your IP as noted in https://discord.com/developers/docs/topics/rate-limits#invalid-request-limit. You can listen for rate limit hits like so:

```ts
const handler = new RESTHandler()

// Listen for bucket rate limit encounters
restHandler.on('rateLimit', (apiRequest, blockedDurationMs) => {
  console.error(`Bucket rate limit hit for ${apiRequest.toString()} (blocked for ${blockedDurationMs}ms)`)
})

// Listen for global rate limit encounters
restHandler.on('globalRateLimit', (apiRequest, blockedDurationMs) => {
  console.error(`Global rate limit hit for ${apiRequest.toString()} (blocked for ${blockedDurationMs}ms)`)
})
```

and take preemptive action *before* the hard limit is reached. At the time of this writing, it is a hard limit of 10,000 rate limit hits within 10 minutes. -->

## Debugging

Set the environment variable `DEBUG` to `discordrest:*`.

```shell
DEBUG=discordrest:*
```
or on Windows:
```powershell
set DEBUG=discordrest:*
```
You will see output like below.
```shell
discordrest:bucket:0123--4567- Enqueuing request https://discord.com/api/channels/4567/messages (#5) +0ms
  discordrest:bucket:0123--4567- Enqueuing request https://discord.com/api/channels/4567/messages (#6) +0ms
  discordrest:bucket:0123--4567- Enqueuing request https://discord.com/api/channels/4567/messages (#7) +1ms
  discordrest:bucket:0123--4567- Enqueuing request https://discord.com/api/channels/4567/messages (#8) +0ms
  discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#5) +1ms
  discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#5) +79ms
  discordrest:bucket:0123--4567- Blocking for 1000ms after non-429 response for https://discord.com/api/channels/4567/messages (#5) +2ms
  discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#5) +1ms
channel 1  0
  discordrest:bucket:0123--4567- Delaying execution until Sun Aug 30 2020 12:18:35 GMT-0400 (Eastern Daylight Time) for https://discord.com/api/channels/4567/messages (#6) +1ms
  discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#6) +1s
  discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#6) +106ms
  discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#6) +3ms
channel 1  1
  discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#7) +1ms
  discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#7) +88ms
  discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#7) +0ms
channel 1  2
  discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#8) +1ms
  discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#8) +88ms
  discordrest:bucket:0123--4567- Finished entire queue +1ms
  discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#8) +1ms
```
