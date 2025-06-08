export const naturalComparer = Intl.Collator([], { usage: 'sort', numeric: true, caseFirst: 'false', sensitivity: 'base', ignorePunctuation: true })
export const naturalCompare = (s1: string, s2: string) => naturalComparer.compare(s1, s2)

export function splitFirst(s: string, sep: string | RegExp): [string, string] {
  const i = typeof sep === 'string' ? s.indexOf(sep) : (sep.exec(s)?.index ?? -1)
  if (i >= 0) {
    return [s.substring(0, i), s.substring(i + 1)]
  } else {
    return [s, '']
  }
}
