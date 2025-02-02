import { getLog, getTrace } from '@my/services'
import { DisposableContainer } from '@my/util'
import { Readable } from 'stream'

import { Cortex, SwvFormat } from './cortex'
import { MiCommands } from './mi.commands'

const log = getLog('SWO')
const trace = getTrace('SWO')

export interface SwoSourcePacket {
  dwt: boolean
  ch: number
  data: Buffer
}

export class SwoSession extends DisposableContainer {
  constructor(
    private readonly mi: MiCommands,
    private readonly swo: Readable,
    private readonly sourcePacket?: (evt: SwoSourcePacket) => void,
  ) {
    super()

    void this.reader() // let the reader run
  }

  async start() {
    // configure trace bits on target
    const cortex = new Cortex(this.mi)

    await cortex.setupTrace({
      cpuFrequency: 72, swvFrequency: 2,
      format: SwvFormat.Manchester,
    })
  }

  private async reader() {
    const done = new Error()

    try {
      log.debug('Starting reader')
      const iter = this.swo[Symbol.asyncIterator]()

      async function read(): Promise<Buffer> {
        for (;;) {
          const res = await iter.next()
          if (res.done) {
            throw done
          }
          if (Buffer.isBuffer(res.value)) {
            if (res.value.length) {
              return res.value
            }
          } else {
            log.warn('Chunk not a buffer', res.value)
          }
        }
      }

      function extract7(buf: Buffer): number {
        // use multiplication instead of shifts as we may be handling more than 32-bit numbers
        let n = 0, mul = 1
        for (let i = 0; i < buf.length; i++, mul *= 128) {
          n += (buf[i] & 0x7F) * mul
        }
        return n
      }

      for (;;) {
        let chunk = await read()

        while (chunk.length) {
          const t = chunk[0]
          let len = t & 3

          if (len === 0) {
            // sync or protocol frame
            if (t === 0) {
              // sync frame
              let cnt = 1
              for (;;) {
                if (chunk.length <= cnt) {
                  // need more
                  chunk = Buffer.concat([chunk, await read()])
                }
                if (chunk[cnt] === 0) {
                  cnt++
                  continue
                }
                if (chunk[cnt] === 0x80 && cnt >= 5) {
                  trace('SYNC')
                  chunk = chunk.subarray(cnt + 1)
                  break
                }
                trace('ERROR')
                chunk = chunk.subarray(cnt)
                break
              }
            } else if (t === 0x70) {
              // overflow
              trace('OVF')
              chunk = chunk.subarray(1)
            } else {
              // protocol frame - top bit is the continuation bit, read as long as it's 1
              len = 1
              while (chunk[len - 1] & 0x80) {
                if (chunk.length <= len) {
                  // need more data
                  chunk = Buffer.concat([chunk, await read()])
                }
                len++
              }
              if (trace.enabled) {
                if ((t & 0xC0) === 0xC0) {
                  trace('LTS1', (t >>> 4) & 3, extract7(chunk.subarray(1, len)))
                } else if (!(t & 0x80)) {
                  trace('LTS2', t >>> 4)
                } else if (t === 0x94) {
                  trace('GTS1', extract7(chunk.subarray(1, len)))
                } else if (t === 0xB4) {
                  trace('GTS2', extract7(chunk.subarray(1, len)))
                } else {
                  trace('PRT', chunk.subarray(0, len).toString('hex'))
                }
              }
              chunk = chunk.subarray(len)
            }
          } else {
            // source frame (ITM or DWT)
            if (len === 3) {
              len = 4
            }
            while (chunk.length <= len) {
              // read enough data
              chunk = Buffer.concat([chunk, await read()])
            }
            const pkt: SwoSourcePacket = {
              dwt: !!(t & 4),
              ch: t >>> 3,
              data: chunk.subarray(1, len + 1),
            }
            if (trace.enabled) {
              trace(pkt.dwt ? 'DWT' : 'ITM', pkt.ch, pkt.data.toString('hex'))
            }
            this.sourcePacket?.(pkt)
            chunk = chunk.subarray(len + 1)
          }
        }
      }
    } catch (error) {
      if (error === done) {
        log.debug('Reader complete')
      } else {
        log.error('Reader failed', error)
      }
    }
  }
}
