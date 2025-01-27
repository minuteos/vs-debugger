import { BmpServerConfiguration } from '@my/configuration'
import { getLog } from '@my/services'
import { getWildcardMatcher } from '@my/util'
import { platform } from 'os'
import { SerialPort } from 'serialport'

import { GdbServer } from './gdb-server'

const log = getLog('BMP')

const BMP_VID = 0x1d50
const BMP_PID = 0x6018

export class BmpGdbServer extends GdbServer {
  private port = ''

  get address() { return this.port }

  constructor(readonly config: BmpServerConfiguration) {
    super()
  }

  async start(): Promise<void> {
    this.port = this.config.port ?? await this.detectPort()
  }

  private async detectPort(): Promise<string> {
    let ports = await SerialPort.list()
    // filter by VID/PID
    ports = ports.filter(p => parseInt(p.vendorId ?? '', 16) === BMP_VID && parseInt(p.productId ?? '', 16) === BMP_PID)
    if (platform() === 'darwin') {
      ports.forEach(p => p.path = p.path.replace('/dev/tty.', '/dev/cu.'))
    }
    // filter by Serial Number, if specified
    if (this.config.serial) {
      const matcher = getWildcardMatcher(this.config.serial)
      ports = ports.filter(p => p.serialNumber && matcher.exec(p.serialNumber))
    }
    // sort by pnpID/path to identify the GDB port (the second one is AUX)
    ports.sort((a, b) => (a.pnpId ?? a.path).localeCompare(b.pnpId ?? b.path))
    if (!ports.length) {
      throw new Error('Failed to autodetect BMP port.\n\nAre you sure you have a BMP connected?')
    }
    log.info('Autodetected BMP port', ports[0].path)
    return ports[0].path
  }
}
