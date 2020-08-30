# Discord-REST

[node-fetch](https://github.com/node-fetch/node-fetch) wrapper meant to gracefully handle the frightening and confusing monster of Discord rate limits.

All requests are executed in order. The goal of this library is to minimize or completely avoid bucket ratelimits. The only rate limits you should be hitting are global ones since Discord does not provide information on global limits for preemptive actions until you actually hit one.

Requests are automatically timed out after 10s.

### Table of Contents
* [Install](#install)
* [Usage](#usage)
* [Handle Invalid Requests](#handle-invalid-requests)
* [Debugging](#debugging)

## Install

```
npm i @synzen/discord-rest
```

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

## Handle Invalid Requests

If you encounter too many invalid requests within a certain time frame, Discord will temporarily block your IP as noted in https://discord.com/developers/docs/topics/rate-limits#invalid-request-limit. An invalid request (as it is currently defined at the time of this writing), is a response of 429, 401, or 403. The hard limit for Discord is 10,000 invalid requests within 10 minutes. You can listen for invalid requests like so:

```ts
const handler = new RESTHandler()

// Listen for API responses with status codes 429, 401 and 403
restHandler.on('invalidRequest', (apiRequest, countSoFar) => {
  console.error(`Invalid request for ${apiRequest.toString()} (${countSoFar} total within 10 minutes)`)
})
```

This library will delay and queue up all further requests for 10 minutes after it encounters 5,000 invalid requests within 10 minutes.

If you'd like to specifically listen for rate limit hits, you can listen to the following events.

```ts
// Listen for bucket rate limit encounters
restHandler.on('rateLimit', (apiRequest, blockedDurationMs) => {
  console.error(`Bucket rate limit hit for ${apiRequest.toString()} (blocked for ${blockedDurationMs}ms)`)
})

// Listen for global rate limit encounters
restHandler.on('globalRateLimit', (apiRequest, blockedDurationMs) => {
  console.error(`Global rate limit hit for ${apiRequest.toString()} (blocked for ${blockedDurationMs}ms)`)
})
```

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
discordrest:bucket:0123--4567- Delaying execution until Sun Aug 30 2020 12:18:35 GMT-0400 (Eastern Daylight Time) for https://discord.com/api/channels/4567/messages (#6) +1ms
discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#6) +1s
discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#6) +106ms
discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#6) +3ms
discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#7) +1ms
discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#7) +88ms
discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#7) +0ms
discordrest:bucket:0123--4567- Executing https://discord.com/api/channels/4567/messages (#8) +1ms
discordrest:bucket:0123--4567- Non-429 response for https://discord.com/api/channels/4567/messages (#8) +88ms
discordrest:bucket:0123--4567- Finished entire queue +1ms
discordrest:bucket:0123--4567- Finished https://discord.com/api/channels/4567/messages (#8) +1ms
```
