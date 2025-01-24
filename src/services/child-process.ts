import { getLog } from '@my/services'
import { Signal } from '@my/util'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'

const log = getLog('ChildProcess')

/**
 * A class representing a child process, managing its lifetime
 */
export class ChildProcess implements AsyncDisposable {
  readonly process: ChildProcessWithoutNullStreams
  readonly arguments: string[]
  readonly pid: number
  private readonly exitSignal = new Signal<number>()

  constructor(readonly command: string, ...args: string[]) {
    this.arguments = args
    this.process = spawn(command, args)
    this.pid = this.process.pid ?? -1
    log.debug('Spawned ', this.pid, command, args)
    this.process.on('error', (err) => {
      log.error('Failed', this.pid)
      this.exitSignal.reject(err)
    })
    this.process.on('exit', (code, signal) => {
      log.debug('Exit', this.pid, code, signal)
      this.exitSignal.resolve(code ?? 0)
    })
  }

  get stdin() { return this.process.stdin }
  get stdout() { return this.process.stdout }
  get stderr() { return this.process.stderr }
  get exitCode() { return this.process.exitCode }

  waitForExit(timeoutMs: number): Promise<number | undefined> {
    return this.exitSignal.wait(timeoutMs)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (typeof this.process.exitCode === 'number') {
      return
    }

    log.trace('Final wait for', this.pid)
    if (await this.exitSignal.wait(1000) === undefined) {
      log.warn('Killing', this.pid)
      if (await this.exitSignal.wait(1000) === undefined) {
        log.error('Failed to kill', this.pid)
      }
    }
    log.trace('Process disposed', this.pid)
  }
}
