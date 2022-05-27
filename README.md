# Discord-REST

A distributed Discord rate limit handler that uses [isomorphic-fetch](https://github.com/matthew-andrews/isomorphic-fetch)'s interface for easy use.

Requesta are enqueued into RabbitMQ using a producer, and is consumed by a consumer.

By default, outgoing requests are throttled at a maximum of 30/second (lower than the [the maximum allowed by Discord](https://discord.com/developers/docs/topics/rate-limits#global-rate-limit), which is 50, to give some buffer for other requests).

### Table of Contents

- [Discord-REST](#discord-rest)
    - [Table of Contents](#table-of-contents)
  - [Install](#install)
  - [Usage](#usage)
  - [Debugging](#debugging)

## Install

```
npm i @synzen/discord-rest
```

## Usage

1. Set up a `RESTConsumer` to get ready to consume incoming requests.

    ```ts
    import { RESTConsumer } from "@synzen/discord-rest";

    const consumer = new RESTConsumer(rabbitmqUri, {
      authHeader: `Bot ${botToken}`,
      clientId: 'Bot client id'
    });

    consumer.initialize()
    .then(() => console.log('Initialized'))
    .catch(console.error)

    // You can use the consumer to also listen to important events. See #handle-invalid-requests section
    ```

2. Set up a `RESTProducer` to send out API requests. Only requests that expect `Content-Type: application/json` is currently supported for simplicity and for it to be serializable to be stored within Redis.

    ```ts
    import { RESTConsumer } from "@synzen/discord-rest";

    const producer = new RESTProducer(rabbitmqUri, {
    clientId: 'Bot client id'
    });

    producer
      .enqueue(
        discordEndpoint,
        {
          // node-fetch options.
          method: "POST",
          body: JSON.stringify(payload),
        },
        {
          // Any meta info you'd like to attach to this request
          meta: 1,
        }
      )
      .then((response) => {
        // Status code (200, 400, etc.)
        console.log(response.status);
        // JSON response
        console.log(response.body);
      })
      .catch(console.error);
    ```

    If you execute multiple requests asynchronously, for example:

    ```ts
    for (let i = 0; i < 3; ++i) {
      producer
        .enqueue("https://discord.com/api/channels/channelID/messages", {
          method: "POST",
          body: JSON.stringify({
            content: i,
          }),
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


If you'd like to specifically listen for global blocks, you can use the following events. Note that this is

```ts
import { GLOBAL_BLOCK_TYPE } from '@synzen/discord-rest';

consumer.on('globalBlock', (blockType, durationMs) => {
  if (blockType === GLOBAL_BLOCK_TYPE.GLOBAL_RATE_LIMIT) {
    // Listen for blocks because of global rate limits from Discord
  } else if (blockType === GLOBAL_BLOCK_TYPE.CLOUDFLARE_RATE_LIMIT) {
    // Listen for blocks because of cloudflare IP bans
  } else if (blockType === GLOBAL_BLOCK_TYPE.INVALID_REQUEST) {
    // Listen for blocks that are encountered from too many invalid requests, which are 429, 401, 403 codes.
    // This is a pre-emptive safety block BEFORE an IP ban from Cloudflare is encountered.
  }
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
