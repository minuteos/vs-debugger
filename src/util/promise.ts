/**
 * Creates a promise that resolves after the specified time.
 * @param ms Number of milliseconds until resolved
 */
export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
