export const naturalComparer = Intl.Collator([], { usage: 'sort', numeric: true, caseFirst: 'false', sensitivity: 'base', ignorePunctuation: true })
export const naturalCompare = (s1: string, s2: string) => naturalComparer.compare(s1, s2)
