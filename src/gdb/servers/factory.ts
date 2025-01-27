import { LaunchConfiguration } from '@my/configuration'

import { BmpGdbServer } from './bmp'
import { GdbServer } from './gdb-server'
import { QemuGdbServer } from './qemu'

const typeMap = {
  qemu: QemuGdbServer,
  bmp: BmpGdbServer,
}

export function createGdbServer(launchConfig: LaunchConfiguration): GdbServer {
  const serverConfig = typeof launchConfig.server === 'object'
    ? launchConfig.server
    : { type: launchConfig.server }

  if (!(serverConfig.type in typeMap)) {
    throw new Error(`Unsupported server type: ${serverConfig.type}`)
  }

  const type = typeMap[serverConfig.type]
  return new type(serverConfig as never, launchConfig)
}
