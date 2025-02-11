import { LaunchConfiguration, SwoConfiguration } from '@my/configuration'
import { GdbServer } from '@my/gdb-server/gdb-server'
import { MiCommands } from '@my/gdb/mi.commands'
import { Plugin } from '@my/plugin'
import { Readable } from 'stream'

export interface SwoOptions {
  launchConfig: LaunchConfiguration
  swoConfig: SwoConfiguration
}

export abstract class Swo<TOptions extends SwoOptions = SwoOptions> extends Plugin<TOptions> {
  abstract connect(): Promise<void>
  enable?(gdbServer: GdbServer, mi: MiCommands): Promise<void>

  declare readonly stream?: Readable
}
