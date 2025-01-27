export function getWildcardMatcher(...wildcards: string[]): RegExp {
  // escape regex characters, but leave ( ) and | (we support alternatives)
  if (!wildcards.length) {
    // do not match anything
    return /(?!.*)/
  }

  const escaped = wildcards.map(s => s.replace(/[.+*?{}]/g, '\\$&'))
  const joined = `(${escaped.join(')|(')})`
  const pattern = joined.replaceAll('\\*', '.*').replaceAll('\\?', '.')
  return new RegExp(`^(?:${pattern})$`, 'i')
}
