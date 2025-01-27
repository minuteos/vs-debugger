import { LaunchConfiguration, QemuServerConfiguration } from '@my/configuration'
import { allocateTcpPort, findExecutable } from '@my/util'

import { ExecutableGdbServer } from './gdb-server'

const DEFAULT_MACHINE = 'netduinoplus2'

export class QemuGdbServer extends ExecutableGdbServer {
  address!: string

  constructor(readonly config: QemuServerConfiguration, readonly launchConfig: LaunchConfiguration) {
    super()
  }

  getExecutable(): Promise<string> {
    return findExecutable('qemu-system-arm')
  }

  async getArguments(): Promise<string[]> {
    this.address = `127.0.0.1:${(await allocateTcpPort()).toString()}`

    return [
      '-machine',
      this.config.machine ?? DEFAULT_MACHINE,
      ...(this.config.cpu ? ['-cpu', this.config.cpu] : []),
      '-semihosting',
      '-nographic',
      '-gdb', `tcp:${this.address}`,
      '-kernel', this.launchConfig.program,
      '-S', // stop at startup
    ]
  }
}
