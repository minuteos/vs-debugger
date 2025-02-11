import { BmpSwoConfiguration } from '@my/configuration'
import { BmpGdbServer } from '@my/gdb-server/drivers/bmp'
import { GdbServer } from '@my/gdb-server/gdb-server'
import { MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { findUsbInterface } from '@my/services/usb'
import { mergeDefaults } from '@my/util'
import { Readable } from 'stream'

import { Swo, SwoOptions } from '../swo'

const log = getLog('BMP-SWO')

interface BmpSwoOptions extends SwoOptions {
  swoConfig: BmpSwoConfiguration
}

export class BmpSwo extends Swo<BmpSwoOptions> {
  async connect(): Promise<void> {
    const swoInterface = await findUsbInterface(mergeDefaults(this.options.swoConfig.port, this.options.swoConfig))

    if (!swoInterface) {
      log.warn('No BMP SWO interface found')
      return
    }

    log.info('SWO interface', swoInterface)
    this.use(await swoInterface.claim())
    const stream = new Readable()
    this.use(swoInterface.inToStream(stream))
    this.set(this, 'stream', stream)
  }

  async enable(gdb: GdbServer, mi: MiCommands) {
    if (!(gdb instanceof BmpGdbServer)) {
      log.warn('Using BMP SWO without BMP as a GDB Server - you need to enable the SWO output manually')
    }

    // enable SWO
    // different versions of BMP use different commands 🤷‍♂️, so we need to look at help to know what to use
    const helpRes = await mi.monitor('help')
    const help = Object.fromEntries(helpRes.$output
      ?.split('\n')
      .map(s => s.split(' -- ', 2))
      .filter(v => v.length === 2)
      .map(([cmd, help]) => [cmd.trim(), help.trim()])
      ?? [],
    )

    if (help.swo) {
      await mi.monitor('swo enable')
    } else {
      await mi.monitor('traceswo enable')
    }
  }
}
