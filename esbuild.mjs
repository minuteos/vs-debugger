import child_process from 'child_process'
import * as esbuild from 'esbuild'
import fs from 'fs/promises'
import { createGenerator } from 'ts-json-schema-generator'

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')
const minify = process.argv.includes('--minify')
const packages = process.argv.includes('--packages')

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started')
    })
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`)
        console.error(`    ${location.file}:${location.line}:${location.column}:`)
      })
      console.log('[watch] build finished')
    })
  },
}

const ctx = await esbuild.context({
  entryPoints: [
    'src/extension.ts',
  ],
  bundle: true,
  format: 'cjs',
  minify: minify || production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'es2022',
  outfile: 'dist/extension.js',
  external: [
    'vscode',
    'usb',
    'serialport',
  ],
  logLevel: 'silent',
  plugins: [
    esbuildProblemMatcherPlugin,
  ],
})

if (packages) {
  await fs.mkdir('dist', { recursive: true })
  await buildPackageJson('package.json', 'package.json')
  await fs.copyFile('package.json', 'dist/package.json')
  await fs.copyFile('package-lock.json', 'dist/package-lock.json')
  await child_process.spawn('npm', ['install', '--ignore-scripts', '--omit', 'dev'], {
    cwd: 'dist',
    stdio: 'inherit',
  })
}

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}

// The published package.json must inline real JSON schemas for the settings
// and the launch/attach configurations. They are derived from the TypeScript
// types (and their doc comments) so there is a single source of truth.
function genSchema(type) {
  function strip(node) {
    if (Array.isArray(node)) {
      node.forEach(strip)
    } else if (node && typeof node === 'object') {
      delete node.$schema
      if (node.definitions && !Object.keys(node.definitions).length) {
        delete node.definitions
      }
      for (const k in node) {
        strip(node[k])
      }
    }
    return node
  }

  return strip(createGenerator({
    path: 'src/settings.ts',
    tsconfig: 'tsconfig.json',
    type,
    functions: 'hide',
    additionalProperties: true,
    jsDoc: 'extended',
    topRef: false,
    expose: 'none',
    skipTypeCheck: true,
    sortProps: false,
  }).createSchema(type))
}

async function buildPackageJson(src, dst) {
  const pkg = JSON.parse(await fs.readFile(src))
  const settings = genSchema('Settings')

  pkg.contributes.configuration.properties = Object.fromEntries(
    Object.entries(settings.properties).map(([k, v]) => [`minuteDebug.${k}`, v]),
  )

  for (const dbg of pkg.contributes.debuggers) {
    dbg.configurationAttributes = {
      launch: genSchema('InputLaunchConfiguration'),
      attach: genSchema('InputLaunchConfiguration'),
    }
  }

  await fs.writeFile(dst, JSON.stringify(pkg, undefined, 2) + '\n')
}
