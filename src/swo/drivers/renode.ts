import { RenodeSwoConfiguration } from '@my/configuration'
import { RenodeGdbServer } from '@my/gdb-server/drivers/renode'
import { GdbServer } from '@my/gdb-server/gdb-server'
import { getLog } from '@my/services'
import { allocateTcpPort } from '@my/util'
import { mkdtemp, writeFile } from 'fs/promises'
import { createServer } from 'net'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'

import { Swo, SwoOptions } from '../swo'
import itmPeripheralSource from './renode-itm.cs'

const log = getLog('Renode-SWO')

// Renode's Cortex-M models omit the CoreSight ITM/DWT/TPIU and the ROM table,
// so there is no native SWO stream. We compile a small C# peripheral
// (renode-itm.cs) into the running emulator and overlay two instances onto
// the machine (without touching the user's .resc):
//
//  - an ITM block at 0xE0000000 that turns each stimulus-port write into a
//    properly framed ITM source packet (see src/gdb/swo.ts for the framing)
//    and streams it to us over a loopback socket, and reports ITM as enabled
//    so the firmware's CMSIS ITM_SendChar actually emits;
//  - a ROM table at 0xE00FF000 that points SCS/DWT/ITM/TPIU at 0xE0000000 so
//    cortex.setupTrace()'s register writes land in the absorbing ITM overlay
//    instead of clobbering low memory.
//
// Neither region is populated by stock Renode platforms, so the overlay does
// not collide with the user's .repl.

const overlayRepl = (port: number) =>
  `itmCapture: Miscellaneous.MinuteItmCapture @ sysbus 0xE0000000
    port: ${port.toString()}

coresightRomTable: Miscellaneous.MinuteRomTable @ sysbus 0xE00FF000
`

interface RenodeSwoOptions extends SwoOptions {
  swoConfig: RenodeSwoConfiguration
}

export class RenodeSwo extends Swo<RenodeSwoOptions> {
  private sourcePath?: string
  private replPath?: string

  async connect(): Promise<void> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'minute-renode-swo-'))
    this.sourcePath = path.join(dir, 'MinuteSwo.cs')
    this.replPath = path.join(dir, 'overlay.repl')

    const stream = new PassThrough()

    // The C# peripheral connects back to us once Renode instantiates it; the
    // accepted socket is the SWO byte stream.
    const server = this.adopt(
      createServer((socket) => {
        socket.pipe(stream)
        socket.on('error', (err) => {
          log.warn('SWO socket error', err)
        })
      }),
      s => new Promise<void>((resolve) => {
        s.close(() => {
          resolve()
        })
      }),
    )

    const port = await allocateTcpPort()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        resolve()
      })
    })

    await writeFile(this.sourcePath, itmPeripheralSource)
    await writeFile(this.replPath, overlayRepl(port))

    this.set(this, 'stream', stream)
  }

  async enable(gdb: GdbServer): Promise<void> {
    if (!(gdb instanceof RenodeGdbServer)) {
      log.warn('Renode SWO requires the Renode GDB server; skipping ITM overlay')
      return
    }
    if (!this.sourcePath || !this.replPath) {
      return
    }
    log.info('Overlaying ITM capture peripheral')
    await gdb.includeFile(this.sourcePath)
    await gdb.loadPlatformOverlay(this.replPath)
  }
}
