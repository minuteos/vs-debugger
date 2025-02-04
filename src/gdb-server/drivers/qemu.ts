import { QemuServerConfiguration } from '@my/configuration'
import { allocateTcpPort, findExecutable } from '@my/util'

import { ExecutableGdbServer, GdbServerOptions } from '../gdb-server'

const DEFAULT_MACHINE = 'netduinoplus2'

interface QemuGdbServerOptions extends GdbServerOptions {
  serverConfig: QemuServerConfiguration
}

export class QemuGdbServer extends ExecutableGdbServer<QemuGdbServerOptions> {
  address!: string
  readonly identity = undefined
  readonly skipLoad = true

  getExecutable(): Promise<string> {
    return findExecutable('qemu-system-arm')
  }

  async getArguments(): Promise<string[]> {
    this.address = `127.0.0.1:${(await allocateTcpPort()).toString()}`

    const { launchConfig, serverConfig } = this.options

    return [
      '-machine',
      serverConfig.machine ?? DEFAULT_MACHINE,
      ...(serverConfig.cpu ? ['-cpu', serverConfig.cpu] : []),
      '-semihosting',
      '-nographic',
      '-gdb', `tcp:${this.address}`,
      '-kernel', launchConfig.program,
      '-S', // stop at startup
    ]
  }

  attach(): Promise<void> {
    return Promise.resolve()
  }
}
