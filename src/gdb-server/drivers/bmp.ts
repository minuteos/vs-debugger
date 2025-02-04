import { BmpServerConfiguration } from '@my/configuration'
import { DebugError, ErrorCode } from '@my/errors'
import { MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { findSerialPort } from '@my/services/serial'
import { findUsbInterface } from '@my/services/usb'
import { mergeDefaults, throwError } from '@my/util'
import { Readable } from 'stream'

import { GdbServer, GdbServerOptions } from '../gdb-server'

const log = getLog('BMP')

interface BmpGdbServerOptions extends GdbServerOptions {
  serverConfig: BmpServerConfiguration
}

export class BmpGdbServer extends GdbServer<BmpGdbServerOptions> {
  private port = ''
  swoStream?: Readable = undefined

  get address() { return this.port }

  async start(): Promise<void> {
    this.port = this.options.serverConfig.port
      ?? await findSerialPort(this.options.serverConfig)
      ?? throwError(new Error('Failed to autodetect BMP port.\n\nAre you sure you have a BMP connected?'))

    log.info('Using serial port', this.port)
    await this.startSwo()
  }

  async startSwo(): Promise<void> {
    const swoInterface = await findUsbInterface(mergeDefaults(this.options.serverConfig.swoPort, this.options.serverConfig))

    if (!swoInterface) {
      log.warn('No BMP SWO interface found')
      return
    }

    log.info('SWO interface', swoInterface)
    this.use(await swoInterface.claim())
    const stream = new Readable()
    this.use(swoInterface.inToStream(stream))
    this.set(this, 'swoStream', stream)
  }

  async attach(mi: MiCommands): Promise<void> {
    log.info('Scanning targets...')

    const res = await mi.monitor('swdp_scan')
    const [voltage, result, , ...targets] = (res.$output ?? '').split('\n')
    if (result != 'Available Targets:') {
      throw new DebugError('BMP swdp_scan failed:\n\n{result}', { result }, undefined, ErrorCode.BmpScanError)
    }

    log.info(voltage)
    log.info('Detected targets', targets)

    await mi.targetAttach(1)
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
