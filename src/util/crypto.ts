import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { pipeline } from 'stream/promises'

export async function calculateHash(hash: string, file: string): Promise<string> {
  const h = createHash(hash)
  const r = createReadStream(file)
  await pipeline(r, h)
  return h.digest('hex')
}
