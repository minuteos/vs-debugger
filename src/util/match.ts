import { getWildcardMatcher } from '@my/util/wildcard'

export type MatchFunction<T> = (value: T) => boolean
export type MatchValueOrFunction<T> = T | T[] | MatchFunction<T>

export type ValueProviderFunction<T> = () => T | Promise<T>
export type ValueProvider<T> = T | ValueProviderFunction<T>

type TraceFunction = (...args: unknown[]) => void

async function getValue<T>(value: ValueProvider<T>): Promise<T> {
  if (typeof value === 'function') {
    return await (value as ValueProviderFunction<T>)()
  } else {
    return value
  }
}

function traceVal(val: unknown): string {
  return typeof val === 'number' ? val.toString(16) : String(val)
}

function match<T>(name: string, criterion: MatchValueOrFunction<T>, value: T, trace?: TraceFunction): boolean {
  if (criterion === undefined) {
    // anything matches
    return true
  }

  if (typeof criterion === 'function') {
    const res = (criterion as MatchFunction<T>)(value)
    if (res) {
      trace?.('Matched', name, traceVal(value))
    } else {
      trace?.('Failed to match', name, traceVal(value))
    }
    return res
  }

  if (typeof criterion === 'string' && typeof value === 'string') {
    // allow wildcards for string match
    const res = !!getWildcardMatcher(criterion).exec(value)
    if (res) {
      trace?.('Matched', name, traceVal(value))
    } else {
      trace?.('Failed to match', name, traceVal(value))
    }
    return res
  }

  if (Array.isArray(criterion)) {
    return !!criterion.find(c => match(name, c, value, trace))
  }

  if (criterion && typeof criterion === 'object' && typeof value === 'object') {
    // match all properties separately
    for (const k in value) {
      if (!match(`${name}.${k}`, criterion[k], value[k], trace)) {
        return false
      }
    }
    return true
  }

  const res = criterion === value
  if (res) {
    trace?.('Matched', name, traceVal(value))
  } else {
    trace?.('Failed to match', name, traceVal(value), '!=', traceVal(criterion))
  }

  return res
}

export class Matcher {
  constructor(private readonly trace?: (...args: unknown[]) => void) {
  }

  async try<T>(name: string, criterion: MatchValueOrFunction<T> | undefined, value: ValueProvider<T | undefined>): Promise<boolean> {
    if (criterion === undefined) {
      // anything matches
      return true
    }

    const { trace } = this

    const val = await getValue(value)
    if (val === undefined) {
      trace?.('Failed to retrieve', name)
      return false
    }

    return match(name, criterion, val, trace)
  }
}
