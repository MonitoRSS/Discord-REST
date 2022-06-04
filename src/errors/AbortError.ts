export class AbortError extends Error {
  name = 'AbortError'
  constructor(message?: string) {
    super(message)

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AbortError)
    }
  }
}
