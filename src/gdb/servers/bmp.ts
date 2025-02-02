import { BmpServerConfiguration } from '@my/configuration'
import { DebugError, ErrorCode } from '@my/errors'
import { MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { findSerialPort } from '@my/services/serial'
import { EndpointDirection, findUsbInterface, TransferType } from '@my/services/usb'
import { throwError } from '@my/util'
import { Readable } from 'stream'

import { GdbServer, GdbServerOptions } from './gdb-server'

const log = getLog('BMP')

const BMP_VID = 0x1d50
const BMP_PID = 0x6018

interface BmpGdbServerOptions extends GdbServerOptions {
  serverConfig: BmpServerConfiguration
}

export class BmpGdbServer extends GdbServer<BmpGdbServerOptions> {
  private port = ''
  swoStream?: Readable = undefined

  get address() { return this.port }

  async start(): Promise<void> {
    this.port = this.options.serverConfig.port
      ?? await findSerialPort({
        deviceId: { vid: BMP_VID, pid: BMP_PID },
        ...this.options.serverConfig,
      })
      ?? throwError(new Error('Failed to autodetect BMP port.\n\nAre you sure you have a BMP connected?'))

    await this.startSwo()
  }

  async startSwo(): Promise<void> {
    const swoInterface = await findUsbInterface({
      deviceId: { vid: BMP_VID, pid: BMP_PID },
      interface: '*Trace Capture',
      endpoints: { type: TransferType.Bulk, direction: EndpointDirection.In },
      ...this.options.serverConfig.swoPort,
    })

    if (!swoInterface) {
      log.warn('No BMP SWO endpoint found')
      return
    }

    this.use(await swoInterface.claim())
    const stream = new Readable()
    this.use(swoInterface.inToStream(stream))
    this.set(this, 'swoStream', stream)
  }

  async launchOrAttach(mi: MiCommands, attach: boolean): Promise<void> {
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

    void attach
  }
}
