import { MiStreamType } from '@my/gdb/mi.events'
import { ChildProcess, getLog, getRawLog } from '@my/services'

import { GdbMi } from './mi'
import { MiCommands } from './mi.commands'

const log = getLog('GDB')
const rawLog = getRawLog('GDB')

export class GdbInstance extends AsyncDisposableStack {
  private gdb?: ChildProcess
  private mi!: GdbMi

  constructor(readonly program: string) {
    super()
  }

  async start(executable: string) {
    log.info('Starting', executable)

    this.defer(() => {
      log.info('Finished with exit code', this.gdb?.exitCode)
    })

    const gdb = this.use(new ChildProcess(executable, '--interpreter=mi2', this.program))
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
    }))
    this.mi = mi

    this.defer(() => {
      log.info('Tearing down GDB')
    })

    if (!await mi.idle(5000)) {
      throw new Error('Timeout waiting for GDB to start')
    }

    log.info('Started', executable)
  }

  get command(): MiCommands {
    return this.mi.command
  }
}
