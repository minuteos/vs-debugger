// git `clean` filter for package.json.
//
// esbuild generates the real settings / launch / attach JSON schemas into
// package.json on every build so the Extension Development Host picks them up.
// That generated content must never be committed: this filter resets the
// generated subtrees back to their placeholder form before git stores the
// blob, so the working tree keeps the schema while git only ever sees the
// placeholders (no diff, no churn).
//
// stdin = working-tree content, stdout = content git should store. On any
// failure the input is emitted unchanged so a broken filter can never corrupt
// a commit.

import { readFileSync } from 'fs'

const input = readFileSync(0, 'utf8')

try {
  const pkg = JSON.parse(input)

  pkg.contributes.configuration.properties = {}
  for (const dbg of pkg.contributes.debuggers) {
    dbg.configurationAttributes = { launch: {}, attach: {} }
  }

  process.stdout.write(JSON.stringify(pkg, undefined, 2) + '\n')
} catch (e) {
  process.stderr.write(`strip-schema: passing through unchanged (${String(e)})\n`)
  process.stdout.write(input)
}
