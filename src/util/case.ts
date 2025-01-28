export function camelToKebab(s: string): string {
  return s.replaceAll(/[A-Z]/g, s => `-${s.toLowerCase()}`)
}

export function kebabToCamel(s: string): string {
  return s.replaceAll(/-[a-z]/g, s => s[1].toUpperCase())
}
