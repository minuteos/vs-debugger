import { LaunchConfiguration } from '@my/configuration'
import { ChildProcess, getLog, getRawLog } from '@my/services'
import { pick } from '@my/util'

import { GdbMi } from './mi'
import { MiCommands, MiExecStatus } from './mi.commands'
import { MiStreamType } from './mi.events'

const log = getLog('GDB')
const rawLog = getRawLog('GDB')

export class GdbInstance extends AsyncDisposableStack {
  private gdb?: ChildProcess
  private _mi!: GdbMi

  constructor(readonly config: LaunchConfiguration, readonly onExec: (evt: MiExecStatus) => void) {
    super()
  }

  async start(executable: string) {
    log.info('Starting', executable)

    this.defer(() => {
      log.info('Finished with exit code', this.gdb?.exitCode)
    })

    const gdb = this.use(
      new ChildProcess(executable, ['--interpreter=mi2', this.config.program],
        pick(this.config, 'cwd', 'env')),
    )
    this.gdb = gdb
    gdb.forwardLines(gdb.stderr, (line) => {
      log.error(line)
    })
    const mi = this.use(new GdbMi(gdb.stdout, gdb.stdin, {
      stream: (type, text) => {
        if (type === MiStreamType.Console) {
          rawLog(text)
        }
      },
      notify: (evt) => {
        void evt
      },
      exec: this.onExec,
    }))
    this._mi = mi

    this.defer(() => {
      log.info('Tearing down GDB')
    })

    if (!await mi.idle(5000)) {
      throw new Error('Timeout waiting for GDB to start')
    }

    log.info('Started', executable)
  }

  get mi(): GdbMi {
    return this._mi
  }

  get running(): boolean {
    return !!this.gdb && typeof this.gdb.exitCode !== 'number'
  }

  get command(): MiCommands {
    return this._mi.command
  }
}
