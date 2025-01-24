import { stat } from 'fs/promises'
import os from 'os'
import path from 'path'
import { env } from 'process'

/**
 * True if the current OS uses extensions for executables, specified in the PATHEXT environement variable.
 */
export const osWithPathExt = os.platform() === 'win32'

/**
 * Looks for an executable in the specified set of paths or the default PATH environment variable,
 * much like a shell does.
 * @param name Name of the executable to look for
 * @param paths Optional override of the paths (directories) in which to look
 * @returns A string with the full path of the found executable, or the original name if not found
 */
export async function findExecutable(name: string, paths?: string[]): Promise<string> {
  paths ??= (env.PATH ?? '').split(path.delimiter)

  const exts = osWithPathExt ? (env.PATHEXT ?? '').split(path.delimiter) : ['']
  for (const p of paths) {
    const withoutExt = path.join(p, name)
    for (const ext of exts) {
      const fullPath = withoutExt + ext
      const s = await stat(fullPath).catch(() => undefined)
      if (s?.isFile() && (s.mode & 0o111)) { // must have at least one executable bit in mode
        return fullPath
      }
    }
  }

  return name
}
