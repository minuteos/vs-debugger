import { BmpServerConfiguration } from '@my/configuration'
import { DebugError, ErrorCode } from '@my/errors'
import { MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { getWildcardMatcher } from '@my/util'
import { platform } from 'os'
import { SerialPort } from 'serialport'

import { GdbServer, GdbServerOptions } from './gdb-server'

const log = getLog('BMP')

const BMP_VID = 0x1d50
const BMP_PID = 0x6018

interface BmpGdbServerOptions extends GdbServerOptions {
  serverConfig: BmpServerConfiguration
}

export class BmpGdbServer extends GdbServer<BmpGdbServerOptions> {
  private port = ''

  get address() { return this.port }

  async start(): Promise<void> {
    this.port = this.options.serverConfig.port ?? await this.detectPort()
  }

  private async detectPort(): Promise<string> {
    const config = this.options.serverConfig
    let ports = await SerialPort.list()
    // filter by VID/PID
    ports = ports.filter(p => parseInt(p.vendorId ?? '', 16) === BMP_VID && parseInt(p.productId ?? '', 16) === BMP_PID)
    if (platform() === 'darwin') {
      ports.forEach(p => p.path = p.path.replace('/dev/tty.', '/dev/cu.'))
    }
    // filter by Serial Number, if specified
    if (config.serial) {
      const matcher = getWildcardMatcher(config.serial)
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

  async launchOrAttach(mi: MiCommands, attach: boolean): Promise<void> {
    log.info('Scanning targets...')

    const res = await mi.interpreterExec('console', 'monitor swdp_scan')
    const [voltage, result, , ...targets] = (res.$output ?? '').split('\n')
    if (result != 'Available Targets:') {
      throw new DebugError('BMP swdp_scan failed:\n\n{result}', { result }, undefined, ErrorCode.BmpScanError)
    }

    log.info(voltage)
    log.info('Detected targets', targets)

    await mi.targetAttach(1)

    void attach
  }
}
