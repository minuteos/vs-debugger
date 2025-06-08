export function range(count: number): number[]
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function range(start: number, count?: number): number[]
export function range(start: number, count?: number): number[] {
  if (count === undefined) {
    count = start
    start = 0
  }
  const arr = new Array<number>(count)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = start++
  }
  return arr
}

export function groupBy<T, K extends PropertyKey>(array: T[], keySelector: (item: T) => K | undefined): Record<K, T[]> {
  const res = {} as Record<K, T[]>
  for (const item of array) {
    const key = keySelector(item)
    if (key !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (res[key] ??= []).push(item)
    }
  }
  return res
}
