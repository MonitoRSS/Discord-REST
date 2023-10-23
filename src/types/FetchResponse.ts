import { IncomingHttpHeaders } from "http"

export interface FetchResponse {
  json: () => Promise<unknown>
  text: () => Promise<string>
  headers: IncomingHttpHeaders
  status: number
}
