import child_process from 'child_process'
import * as esbuild from 'esbuild'
import fs from 'fs/promises'

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
