export function getProperty(target: unknown, property: PropertyKey): unknown {
  return target && typeof target === 'object'
    ? (target as Record<PropertyKey, unknown>)[property]
    : undefined
}

export function pick<T extends object, K extends keyof T>(obj: T, ...keys: K[]) {
  return Object.fromEntries(
    keys
      .filter(key => key in obj)
      .map(key => [key, obj[key]]),
  ) as Pick<T, K>
}

export function inclusivePick<T extends object, K extends PropertyKey>(
  obj: T, ...keys: K[]
) {
  return Object.fromEntries(
    keys
      .map(key => [key, obj[key as unknown as keyof T]]),
  ) as { [key in K]: key extends keyof T ? T[key] : undefined }
}

export function omit<T extends object, K extends keyof T>(
  obj: T, ...keys: K[]
) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>
}

export function mergeDefaults<T extends object>(target: T, defaults: Partial<T>) {
  const res = { ...target }
  for (const k in defaults) {
    const v = defaults[k]
    if (v === undefined || v === null) {
      continue
    }
    if (!(k in res)) {
      res[k] = v
    } else {
      const tv = res[k]
      if (tv && typeof tv === 'object' && !Array.isArray(tv) && typeof v === 'object') {
        // deep merge
        res[k] = mergeDefaults(tv, v)
      }
    }
  }
  return res
}
