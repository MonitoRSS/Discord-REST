import { IncomingHttpHeaders } from "http"

export interface FetchResponse {
  json: <T>() => Promise<T>
  text: () => Promise<string>
  headers: IncomingHttpHeaders
  status: number
}
