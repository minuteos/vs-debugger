/**
 * Creates a promise that resolves after the specified time.
 * @param ms Number of milliseconds until resolved
 */
export function delay(ms: number): Promise<undefined> {
  return new Promise(r => setTimeout(r, ms))
}

export interface PromiseWithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/**
 * Creates a promise and returns it together with its corresponding resolve/reject methods.
 * @returns Promise with interfaces
 */
export function promiseWithResolvers<T = void>(): PromiseWithResolvers<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((r, e) => {
    resolve = r
    reject = e
  })
  return { promise, resolve, reject }
}
