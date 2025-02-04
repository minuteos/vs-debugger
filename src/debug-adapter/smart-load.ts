import { calculateHash } from '@my/util'
import path from 'path'

const lastProgram = new Map<string, string>()

/**
 * Determines whether loading can be skipped for the given program and debug adapter.
 */
export async function smartLoadSkip(cwd: string | undefined, program: string, adapterId: string): Promise<boolean> {
  let hash
  try {
    hash = await calculateHash('sha256', path.join(cwd ?? '.', program))
  } catch {
    lastProgram.delete(adapterId)
    return false
  }

  if (lastProgram.get(adapterId) === hash) {
    return true
  }

  lastProgram.set(adapterId, hash)
  return false
}
