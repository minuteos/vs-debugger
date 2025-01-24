import { delay, promiseWithResolvers } from '@my/util'

/**
 * A simple promise that can be resolved externally and waited for,
 * useful for e.g. waiting for results of operations confirmed by events
 */
export class Signal<T = true> implements Promise<T> {
  private readonly p = promiseWithResolvers<T>()

  get resolve() { return this.p.resolve }
  get reject() { return this.p.reject }
  async wait(timeoutMs: number): Promise<T | undefined> {
    const res = await Promise.race([this.p.promise, delay(timeoutMs)])
    return res
  }

  get then() { return this.p.promise.then.bind(this.p.promise) }
  get catch() { return this.p.promise.catch.bind(this.p.promise) }
  get finally() { return this.p.promise.finally.bind(this.p.promise) }
  readonly [Symbol.toStringTag] = 'Signal'
}
