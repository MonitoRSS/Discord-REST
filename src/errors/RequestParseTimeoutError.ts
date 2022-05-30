export class RequestParseTimeoutError extends Error {
  constructor(message = 'Parsing request body timed out after 10 minutes') {
    super(message)

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RequestParseTimeoutError)
    }
  }
}
