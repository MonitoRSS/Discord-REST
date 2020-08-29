import fetch, { RequestInit, Response } from 'node-fetch'

class APIRequest {
  route: string
  options?: RequestInit
  id: number
  static lastId = 0

  constructor (route: string, options?: RequestInit) {
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
