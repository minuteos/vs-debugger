import { LaunchConfiguration } from '@my/configuration'
import { StlinkGdbServer } from '@my/gdb-server/drivers/stlink'

import { BmpGdbServer } from './drivers/bmp'
import { QemuGdbServer } from './drivers/qemu'
import { GdbServer } from './gdb-server'

const typeMap = {
  qemu: QemuGdbServer,
  bmp: BmpGdbServer,
  stlink: StlinkGdbServer,
}

export function createGdbServer(launchConfig: LaunchConfiguration): GdbServer {
  const { server } = launchConfig

  if (!(server.type in typeMap)) {
    throw new Error(`Unsupported server type: ${server.type}`)
  }

  const type = typeMap[server.type]
  return new type({ launchConfig, serverConfig: server as never })
}
