import { LaunchConfiguration } from '@my/configuration'
import { ChildProcess, getLog, getRawLog } from '@my/services'
import { DisposableContainer, pick } from '@my/util'
import { BehaviorSubject, lastValueFrom, takeWhile, timeout } from 'rxjs'

import { GdbMi } from './mi'
import { MiCommands, MiExecStatus } from './mi.commands'
import { MiStreamType } from './mi.events'

const log = getLog('GDB')
const rawLog = getRawLog('GDB')

export class GdbInstance extends DisposableContainer {
  private gdb?: ChildProcess
  private _mi!: GdbMi
  private _threads = new BehaviorSubject<MiExecStatus[]>([])

  constructor(readonly config: LaunchConfiguration) {
    super()
  }

  get threads$() { return this._threads.asObservable() }
  get threads() { return this._threads.value }

  async start(executable: string) {
    this._threads.subscribe((t) => {
      log.trace('threads', t)
    })
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

    this.gdb.process.once('exit', () => {
      this._threads.complete()
    })

    const mi = this.use(new GdbMi(gdb.stdout, gdb.stdin, {
      stream: (type, text) => {
        if (type === MiStreamType.Console) {
          rawLog(text)
        }
      },
      notify: (evt) => {
        switch (evt.$class) {
          case 'thread-created': {
            this._threads.next([...this.threads, {
              $class: 'stopped',
              threadId: evt.id,
              reason: 'new',
            }])
            break
          }

          case 'thread-exited': {
            this._threads.next(this.threads.filter(t => t.threadId !== evt.id))
            break
          }
        }
      },
      exec: (evt) => {
        this._threads.next(this.threads.map(t =>
          (typeof evt.threadId === 'string' && evt.threadId === 'all') || evt.threadId === t.threadId
            ? { ...evt, threadId: t.threadId }
            : t,
        ))
      },
    }))
    this._mi = mi

    this.defer(() => {
      log.debug('Stopping')
    })

    if (!await mi.idle(5000)) {
      throw new Error('Timeout waiting for GDB to start')
    }

    log.debug('Started', executable)
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

  threadsStopped(timeoutMs = 5000) {
    return this.threadsInState(s => !s.find(t => t.$class !== 'stopped'), timeoutMs)
  }

  threadsNotStopped(timeoutMs = 5000) {
    return this.threadsInState(s => !!s.find(t => t.$class !== 'stopped'), timeoutMs)
  }

  private threadsInState(predicate: (state: MiExecStatus[]) => boolean, timeoutMs: number) {
    return lastValueFrom(
      this.threads$.pipe(
        takeWhile(s => !predicate(s)),
        timeout(timeoutMs),
      ),
      { defaultValue: undefined })
  }
}
