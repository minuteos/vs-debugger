export function getProperty(target: unknown, property: PropertyKey): unknown {
  return target && typeof target === 'object'
    ? (target as Record<PropertyKey, unknown>)[property]
    : undefined
}
