import APIRequest from "../APIRequest"
import Bucket from "../Bucket"
import APIRequestLifetime from "./APIRequestLifetime"

describe('APIRequestLifetime', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })
  it('emits longLived after 30 minutes', () => {
    const apiRequest = {} as APIRequest
    const bucket = {} as Bucket
    const lifetime = new APIRequestLifetime(apiRequest, bucket)
    const lifetimeEmit = jest.spyOn(lifetime, 'emit')
    // Check longLived was not emitted
    expect(lifetimeEmit.mock.calls.find((call) => call[0] === 'longLived'))
      .toBeUndefined()
    // Advance timers by 30 minutes for the lifetime to be long lived
    jest.advanceTimersByTime(1000 * 60 * 30)
    // Check longLived was emitted
    expect(lifetimeEmit.mock.calls.find((call) => call[0] === 'longLived'))
      .toBeDefined()
  })
  describe('getBucketUnblockTime', () => {
    it('works', () => {
      const blockedUntil = new Date('1/1/5000')
      const apiRequest = {} as APIRequest
      const bucket = {
        blockedUntil
      } as Bucket
      const lifetime = new APIRequestLifetime(apiRequest, bucket)
      expect(lifetime.getBucketUnblockTime())
        .toEqual(blockedUntil)
    })
  })
  describe('hasFinishedRequest', () => {
    it('works', () => {
      const apiRequest = {
        fetchSuccess: true
      } as APIRequest
      const bucket = {} as Bucket
      const lifetime = new APIRequestLifetime(apiRequest, bucket)
      expect(lifetime.hasFinishedRequest())
        .toEqual(true)
    })
  })
  describe('end', () => {
    it('clears the timer so it never emits longLived', () => {
      const apiRequest = {} as APIRequest
      const bucket = {} as Bucket
      const lifetime = new APIRequestLifetime(apiRequest, bucket)
      // End the lifetime so even after 30 minutes pass, nothing should happen
      lifetime.end()
      const lifetimeEmit = jest.spyOn(lifetime, 'emit')
      // Check longLived was not emitted
      expect(lifetimeEmit.mock.calls.find((call) => call[0] === 'longLived'))
        .toBeUndefined()
      // Advance timers by 30 minutes to see if anything happens
      jest.advanceTimersByTime(1000 * 60 * 30)
      // Check longLived was emitted
      expect(lifetimeEmit.mock.calls.find((call) => call[0] === 'longLived'))
        .toBeUndefined()
    })
    it('removes listeners', () => {
      const apiRequest = {} as APIRequest
      const bucket = {} as Bucket
      const lifetime = new APIRequestLifetime(apiRequest, bucket)
      const shouldNotRun = jest.fn()
      lifetime.on('longLived', () => shouldNotRun())
      expect(lifetime.listenerCount('longLived')).toEqual(1)
      // End the lifetime to remove the listeners
      lifetime.end()
      expect(lifetime.listenerCount('longLived')).toEqual(0)
      expect(shouldNotRun).not.toHaveBeenCalled()
    })
  })
})
