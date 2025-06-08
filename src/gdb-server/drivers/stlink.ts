import { StlinkServerConfiguration } from '@my/configuration'
import { probeTarget } from '@my/dap/probe'
import { StlinkDebugAccessPort } from '@my/dap/stlink'
import { MiCommands } from '@my/gdb/mi.commands'
import { DebugTarget } from '@my/interfaces'
import { Signal } from '@my/util'
import { Readable } from 'stream'
import { OutEndpoint } from 'usb'

import { GdbServerOptions, TargetInfo } from '../gdb-server'
import { InternalGdbServer } from '../internal'

interface StlinkGdbServerOptions extends GdbServerOptions {
  serverConfig: StlinkServerConfiguration
}

export class StlinkGdbServer extends InternalGdbServer<StlinkGdbServerOptions> {
  private uid?: string
  private port?: string
  readonly swoStream?: Readable
  readonly dap!: StlinkDebugAccessPort
  private target?: DebugTarget
  private done = false
  private out!: OutEndpoint
  private rx?: Signal<Buffer>

  get identity() { return this.uid ?? this.port }

  async start(): Promise<void> {
    const dap = this.use(await StlinkDebugAccessPort.fromUsb(this.options.serverConfig))
    this.set(this, 'dap', dap)
    await super.start()
  }

  async attach(mi: MiCommands): Promise<TargetInfo> {
    await this.dap.connect()
    await this.getTarget()
    await mi.targetAttach(1)

    return { model: this.target?.info.device }
  }

  async getTarget(): Promise<DebugTarget> {
    return this.target ??= await this.probe()
  }

  private probe(): Promise<DebugTarget> {
    return probeTarget(this.dap)
  }
}
