export function camelToKebab(s: string): string {
  return s.replaceAll(/[A-Z]/g, s => `-${s.toLowerCase()}`)
}
