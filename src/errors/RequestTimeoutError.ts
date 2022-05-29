export class RequestTimeoutError extends Error {
  constructor(message = 'Request in job timed out') {
    super(message)

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestTimeoutError)
    }
  }
}
