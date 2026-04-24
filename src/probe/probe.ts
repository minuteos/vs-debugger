import { LaunchConfiguration } from '@my/configuration'
import { createGdbServer } from '@my/gdb-server/factory'
import { GdbServer, TargetInfo } from '@my/gdb-server/gdb-server'
import { GdbInstance } from '@my/gdb/instance'
import { MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { createSmu } from '@my/smu/factory'
import { Smu } from '@my/smu/smu'
import { createSwo } from '@my/swo/factory'
import { Swo } from '@my/swo/swo'
import { DisposableContainer, findExecutable, throwError } from '@my/util'

import { smartLoadSkip } from './smart-load'

const log = getLog('Probe')

export type LoadProgress = (message: string, fraction?: number) => void

/**
 * Encapsulates a debug probe: a GDB instance attached to a GDB server, with an
 * optional SMU. Setup (GDB, server, SMU start, target-select, attach) and the
 * smart-load-aware program download are both exposed so they can be reused by
 * the DAP session and by the stand-alone flash API.
 */
export class Probe extends DisposableContainer {
  private _gdb?: GdbInstance
  private _server?: GdbServer
  private _smu?: Smu
  private _swo?: Swo
  private _target?: TargetInfo

  constructor(readonly config: LaunchConfiguration) {
    super()
  }

  get gdb(): GdbInstance {
    const gdb = this._gdb ?? throwError(new Error('GDB not started'))
    if (!gdb.running) {
      throw new Error('GDB lost')
    }
    return gdb
  }

  get server(): GdbServer {
    return this._server ?? throwError(new Error('Probe not connected'))
  }

  get smu(): Smu | undefined {
    return this._smu
  }

  get swo(): Swo | undefined {
    return this._swo
  }

  get target(): TargetInfo {
    return this._target ?? throwError(new Error('Probe not connected'))
  }

  get command(): MiCommands {
    return this.gdb.command
  }

  async connect(): Promise<void> {
    this._gdb = this.use(new GdbInstance(this.config))
    this._server = this.use(createGdbServer(this.config))
    this._smu = this.use(createSmu(this.config))
    this._swo = this.use(createSwo(this.config))
    await Promise.all([
      this._gdb.start(await findExecutable('arm-none-eabi-gdb')),
      this._server.start(),
      this._smu?.connect(),
      this._swo?.connect(),
    ])

    await this.command.gdbSet('mi-async', 1)
    await this.command.gdbSet('mem', 'inaccessible-by-default', 0)
    await this.command.targetSelect('extended-remote', this._server.address)

    this._target = await this._server.attach(this.command)

    await this.gdb.threadsStopped()
  }

  /**
   * Downloads the program to the target, honoring smartLoad and the server's
   * skipLoad flag. Returns true if the program was actually flashed, false if
   * the download was skipped (smart-load hit or server doesn't support load).
   */
  async load(report?: LoadProgress): Promise<boolean> {
    if (this.server.skipLoad) {
      return false
    }

    if (this.config.smartLoad
      && this.server.identity
      && await smartLoadSkip(this.config.cwd, this.config.program, this.server.identity)) {
      log.info('SmartLoad: program already loaded')
      return false
    }

    await this.command.targetDownload((status) => {
      report?.(`section ${status.section}`, status.sectionSent / status.sectionSize)
    })
    return true
  }
}
