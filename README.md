# Discord-REST

[node-fetch](https://github.com/node-fetch/node-fetch) wrapper meant to gracefully handle the frightening and confusing monster of Discord rate limits.

All requests are executed in order. The goal of this library is to minimize both bucket and global rate limits with a minimal public interface for maximum flexibility.

By default, outgoing requests are throttled at a maximum of 20/second to avoid global rate limits. Since Discord does not provide global rate limit information for pre-emptive action, this is a guesstimate that has worked well for me - but this is a configurable option.

### Table of Contents

- [Install](#install)
- [Usage](#usage)
  - [Examples](#examples)
  - [Custom Options](#custom-options)
- [Handle Invalid Requests](#handle-invalid-requests)
- [Debugging](#debugging)

## Install

```
npm i @synzen/discord-rest
```

## Usage

### Examples

```ts
import { RESTHandler } from "@synzen/discord-rest";

const handler = new RESTHandler();

// node-fetch arguments
handler
  .fetch("https://discord.com/api/channels/channelID/messages", {
    method: "POST",
    body: JSON.stringify({
      content: "abc",
    }),
    headers: {
      Authorization: `Bot ${process.env.BOT_TOKEN}`,
      // Specifically for JSON responses
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  })
  .then((res) => res.json())
  .then(console.log)
  .catch(console.error);
```

If you execute multiple requests asynchronously, for example:

```ts
for (let i = 0; i < 3; ++i) {
  executor
    .fetch("https://discord.com/api/channels/channelID/messages", {
      method: "POST",
      body: JSON.stringify({
        content: i,
      }),
      headers: {
        Authorization: `Bot ${process.env.BOT_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    })
    .then(() => console.log(i))
    .catch(console.error);
}
```

```shell
1
2
3
```

You will notice that they are executed in order since they are all within the same rate limit bucket.

### Custom Options

Options can be passed into the `RESTHandler`.

```ts
import { RESTHandler } from "@synzen/discord-rest";

const options = {
  /**
   * Maximum number of invalid requests allowed within 10
   * minutes before delaying all further requests by
   * 10 minutes. For more details, see the Handle Invalid
   * Requests section.
   *
   * Default is half of the hard limit, where the hard limit
   * is 10,000. Has no effect if delayOnInvalidThreshold is
   * false.
   */
  invalidRequestsThreshold: 5000,
  /**
   * Whether to delay all requests by 10 minutes when the
   * invalid requests threshold is reached. For more details,
   * see the Handle Invalid Requests section.
   *
   * Default is true
   */
  delayOnInvalidThreshold: true,
  /**
   * Milliseconds to wait for an API request before automatically
   * timing it out
   *
   * Default is 10000 (10 seconds)
   */
  requestTimeout: 10000,
  /**
   * Number of request retries on API request timeouts
   *
   * Default is 3
   */
  requestTimeoutRetries: 3,
  /**
   * Multiple of the duration to block the queue by when a global
   * limit is hit. It could be safer to block longer than what Discord
   * suggests for safety.
   *
   * Default is 1
   */
  globalBlockDurationMultiple: 1,
  /**
   * Maximum number of requests to execute per second.
   *
   * Default is 50 since it is the maximum allowed by Discord
   * https://discord.com/developers/docs/topics/rate-limits#global-rate-limit
   */
  maxRequestsPerSecond: 50,
};

const restHandler = new RESTHandler(options);
```

## Handle Invalid Requests

If you encounter too many invalid requests within a certain time frame, Discord will temporarily block your IP as noted in https://discord.com/developers/docs/topics/rate-limits#invalid-request-limit. An invalid request (as it is currently defined at the time of this writing), is a response of 429, 401, or 403. The hard limit for Discord is 10,000 invalid requests within 10 minutes. You can listen for invalid requests like so:

```ts
const handler = new RESTHandler();

// Listen for API responses with status codes 429, 401 and 403
restHandler.on("invalidRequest", (apiRequest, countSoFar) => {
  console.error(
    `Invalid request for ${apiRequest.toString()} (${countSoFar} total within 10 minutes)`
  );
});
```

This library will delay and queue up all further requests for 10 minutes after it encounters 5,000 invalid requests within 10 minutes. You can listen to this event.

```ts
restHandler.on("invalidRequestsThreshold", (threshold) => {
  console.error(
    `Number of invalid requests exceeded threshold (${threshold}), delaying all tasks by 10 minutes`
  );
});
```

If you'd like to specifically listen for rate limit hits, you can use the following events.

```ts
// Listen for bucket rate limit encounters
restHandler.on("rateLimit", (apiRequest, blockedDurationMs) => {
  console.error(
    `Bucket rate limit hit for ${apiRequest.toString()} (blocked for ${blockedDurationMs}ms)`
  );
});

// Listen for global rate limit encounters
restHandler.on("globalRateLimit", (apiRequest, blockedDurationMs) => {
  console.error(
    `Global rate limit hit for ${apiRequest.toString()} (blocked for ${blockedDurationMs}ms)`
  );
});
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
