import { BmpServerConfiguration } from '@my/configuration'
import { DebugError, ErrorCode } from '@my/errors'
import { MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { findSerialPort } from '@my/services/serial'
import { throwError } from '@my/util'

import { GdbServer, GdbServerOptions } from '../gdb-server'

const log = getLog('BMP')

interface BmpGdbServerOptions extends GdbServerOptions {
  serverConfig: BmpServerConfiguration
}

export class BmpGdbServer extends GdbServer<BmpGdbServerOptions> {
  private port = ''
  private uid?: string

  get address() { return this.port }
  get identity() { return this.uid ?? this.port }

  async start(): Promise<void> {
    this.port = this.options.serverConfig.port
      ?? await findSerialPort(this.options.serverConfig)
      ?? throwError(new Error('Failed to autodetect BMP port.\n\nAre you sure you have a BMP connected?'))

    log.info('Using serial port', this.port)
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

    this.uid = (await mi.monitor('uid')).$output
  }
}
