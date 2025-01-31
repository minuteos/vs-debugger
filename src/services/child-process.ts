import { getLog } from '@my/services'
import { readLines, Signal } from '@my/util'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { Readable } from 'stream'

const log = getLog('ChildProcess')

interface ChildProcessOptions {
  cwd?: string
  env?: Record<string, string>
}

/**
 * A class representing a child process, managing its lifetime
 */
export class ChildProcess extends AsyncDisposableStack {
  readonly process: ChildProcessWithoutNullStreams
  readonly arguments: string[]
  readonly pid: number
  private readonly exitSignal = new Signal<number>()

  constructor(readonly command: string, args: string[], opts?: ChildProcessOptions) {
    super()
    this.arguments = args
    this.process = spawn(command, args, opts)
    this.defer(() => this.finalWait())
    this.pid = this.process.pid ?? -1
    log.debug('Spawned', this.pid, command, args)
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

  forward(stream: Readable, target: (chunk: Buffer) => void) {
    const reader = (async () => {
      for await (const chunk of stream) {
        if (Buffer.isBuffer(chunk)) {
          target(chunk)
        }
      }
    })()
    this.defer(() => reader)
  }

  forwardLines(stream: Readable, target: (line: string) => void) {
    const reader = (async () => {
      for await (const line of readLines(stream)) {
        target(line.toString())
      }
    })()
    this.defer(() => reader)
  }

  private async finalWait(): Promise<void> {
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
