import { getLog } from '@my/services'
import { Settings, settings } from '@my/settings'
import { getWildcardMatcher } from '@my/util'

let categories: Record<string, boolean> | undefined

let cache: {
  settings: Settings
  categories?: Record<string, boolean>
  enabled: Record<string, boolean>
} | undefined

function getCache(): Record<string, boolean> {
  if (cache && cache.settings === settings && cache.categories === categories) {
    return cache.enabled
  }

  const match = getWildcardMatcher(...settings.trace)

  return (cache = {
    settings,
    categories,
    enabled: categories
      ? Object.fromEntries(Object.keys(categories).map(k => [k, !!match.exec(k)]))
      : {},
  }).enabled
}

export function traceEnabled(category: string): boolean {
  return getCache()[category]
}

export function getTrace(category: string): (...args: unknown[]) => void {
  if (!categories?.[category]) {
    categories = { ...categories, [category]: true }
  }

  const log = getLog(category)
  return (...args) => {
    if (traceEnabled(category)) {
      log.trace(...args)
    }
  }
}
