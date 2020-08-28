import fetch, { RequestInit, Response } from 'node-fetch'
import { EventEmitter } from 'events'

class APIRequest extends EventEmitter {
  route: string
  options?: RequestInit
  id: number
  static lastId = 0

  constructor (route: string, options?: RequestInit) {
    super()
    this.route = route
    this.options = options
    this.id = ++APIRequest.lastId
  }

  async execute (): Promise<Response> {
    const res = await fetch(this.route, this.options)
    return res
  }

  toString (): string {
    return `${this.route} (#${this.id})`
  }
}

export default APIRequest
