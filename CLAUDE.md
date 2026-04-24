# CLAUDE.md

Guidance for working in this repo.

## Layout

- `src/` is organized by domain. Each external dependency or hardware concern
  gets its own folder: `gdb/`, `gdb-server/`, `smu/`, `swo/`, `services/`,
  `util/`, `debug-adapter/`, `probe/`. Top-level files are reserved for
  cross-cutting pieces like `configuration.ts`, `settings.ts`, `defaults.ts`,
  `errors.ts`, `plugin.ts`, `extension.ts`.
- New functionality that spans multiple existing domains gets its own folder
  rather than living at the root. `src/probe/` is an example: it composes
  `gdb`, `gdb-server`, `smu`, and `swo`.
- Folders that have a clear surface export through their files directly; most
  do not have an `index.ts`. Use `@my/<folder>/<file>` from outside, relative
  `./<file>` from inside the same folder. `services/` and `util/` are the
  exceptions — they re-export through `index.ts`.

## Style

- No semicolons, single quotes, 2-space indent. `@stylistic/eslint-plugin`
  with `braceStyle: '1tbs'` enforces the rest.
- `perfectionist/sort-imports` sorts imports alphabetically by module path,
  with `@my/*` treated as internal. Intra-folder relative imports go in a
  separate group after the `@my/*` block.
- Use the `@my/*` path alias (maps to `./src/*`) for cross-folder imports.
- Type-checked ESLint is strict — `tseslint.configs.strictTypeChecked` plus
  the `stylistic` variant. Prefer `type` aliases over single-call-signature
  interfaces. JSDoc blocks need a blank line before them.
- Prefer `throwError(new Error(...))` from `@my/util` in `??` expressions
  rather than ternaries.

## Conventions

- Resources that need teardown extend `DisposableContainer` (wraps
  `AsyncDisposableStack`). Register child resources with `this.use(...)`;
  container is disposed via `Symbol.asyncDispose` or explicit
  `disposeAsync()`.
- Long-running tasks report progress through the `progress()` service
  (`@my/services`), which renders via `vscode.window.withProgress`. Don't
  call the VS Code API directly.
- Logging goes through `getLog('Tag')` / `getTrace('tag')` from
  `@my/services`. Don't use `console.*` outside `extension.ts` activate /
  deactivate.
- Launch configuration goes through `expandConfiguration()` in
  `@my/configuration`, which resolves preset names against `settings` and
  applies defaults. Take `InputLaunchConfiguration` at API boundaries,
  `LaunchConfiguration` internally.

## Scripts

- `npm run check-types` — `tsc --noEmit`
- `npm run lint` — `eslint src`
- `npm run compile` — check-types + lint + esbuild bundle

All three must pass. `lint-staged` runs ESLint on staged `.{js,mjs,ts}`
files via a husky pre-commit hook — don't bypass it.

## Activation

`extension.ts` activate returns the public API object. Keep that object
small and typed (`MinuteDebugApi`). Types consumed by other extensions are
re-exported from `extension.ts` so they can be imported without reaching
into internal paths.
