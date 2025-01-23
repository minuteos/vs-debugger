import { getLog } from '@my/services'
import { settings } from '@my/settings'

export function traceEnabled(category: string): boolean {
  return !!settings.trace[category.toLowerCase()]
}

export function getTrace(category: string): (...args: unknown[]) => void {
  const log = getLog(category)
  const traceProp = category.toLowerCase()
  return (...args) => {
    if (settings.trace[traceProp]) {
      log.trace(...args)
    }
  }
}
