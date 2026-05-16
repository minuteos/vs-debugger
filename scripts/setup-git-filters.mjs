// Registers the `schemagen` git clean filter (see scripts/strip-schema.mjs)
// for this clone. Run from the `prepare` npm script so it is configured on
// install. Tolerates environments without git (e.g. installed as a tarball).

import { execFileSync } from 'child_process'

try {
  execFileSync('git', ['config', 'filter.schemagen.clean', 'node scripts/strip-schema.mjs'])
} catch (e) {
  process.stderr.write(`setup-git-filters: skipped (${String(e)})\n`)
}
