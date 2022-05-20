export class MessageParseError extends Error {
  constructor(message?: string) {
    super(message)

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MessageParseError)
    }
  }
}
