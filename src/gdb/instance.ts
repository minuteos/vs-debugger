import { ChildProcess, getLog } from '@my/services'
import { readLines } from '@my/util'

import { GdbMi } from './mi'

const log = getLog('GDB')

export class GdbInstance extends AsyncDisposableStack {
  private gdb?: ChildProcess

  async start(executable: string) {
    log.info('Starting', executable)
    this.gdb = this.use(new ChildProcess(executable, '--interpreter=mi2'))
    const readErrors = (async () => {
      for await (const line of readLines(process.stderr)) {
        log.error(line)
      }
    })()
    this.defer(() => readErrors)
    const mi = this.use(new GdbMi(this.gdb.stdout, this.gdb.stdin))
    if (!await mi.idle(5000)) {
      throw new Error('Timeout waiting for GDB to start')
    }
    log.info('Started', executable)
  }

  override async disposeAsync(): Promise<void> {
    log.info('Tearing down GDB')
    await super.disposeAsync()
    log.info('Finished with exit code', this.gdb?.exitCode)
  }
}
