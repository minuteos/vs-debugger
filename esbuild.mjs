import child_process from 'child_process'
import * as esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'

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
  await buildPackageJson('package.json', 'dist/package.json')
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

async function buildPackageJson(src, dst) {
  function merge(o, i) {
    for (const k in i) {
      if (typeof o[k] === 'object' && typeof i[k] === 'object') {
        merge(o[k], i[k])
      } else if (!(k in o)) {
        o[k] = i[k]
      }
    }
  }

  async function process(o, relativeTo) {
    const inc = o.$$include
    delete o.$$include
    delete o.$schema

    for (const k in o) {
      if (typeof o[k] === 'object') {
        await process(o[k], relativeTo)
      }
    }

    if (inc) {
      const p = path.join(path.dirname(relativeTo), inc)
      const i = JSON.parse(await fs.readFile(p))
      await process(i, p)
      merge(o, i)
    }
  }

  const pkg = JSON.parse(await fs.readFile(src))
  await process(pkg, src)
  await fs.writeFile(dst, JSON.stringify(pkg, undefined, 2))
}
