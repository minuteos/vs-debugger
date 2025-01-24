import { getLog, getRawLog, getTrace } from '@my/services'
import { readLines, Signal } from '@my/util'
import { Readable, Writable } from 'stream'
import { promisify } from 'util'

const log = getLog('MI')
const trace = getTrace('MI')
const gdbLog = getRawLog('GDB')

const PROMPT = '(gdb) ' // received when GDB goes idle

enum StreamType {
  Console = '~',
  Target = '@',
  Log = '&',
}

export class GdbMi extends AsyncDisposableStack {
  private readonly receiverPromise: Promise<void>
  private readonly idleSignal = new Signal()

  constructor(private readonly input: Readable, private readonly output: Writable) {
    super()

    this.receiverPromise = this.receiver()
    this.defer(async () => {
      log.debug('Closing output channel')
      await promisify(output.end.bind(output))()
      log.debug('Waiting for receiver to complete')
      await this.receiverPromise
      log.debug('Cleanup complete')
    })
  }

  private async receiver(): Promise<void> {
    log.info('Starting receiver')
    try {
      for await (const lineBuf of readLines(this.input)) {
        this.process(String(lineBuf))
      }

      log.info('Receiver finished')
      this.idleSignal.reject(new Error('GDB is gone'))
    } catch (error) {
      log.error('Receiver failed', error)
      this.idleSignal.reject(error)
    }
  }

  private process(line: string) {
    trace('<', line)

    if (line == PROMPT) {
      this.idleSignal.resolve(true)
      return
    }

    switch (line[0]) {
      case '~':
      case '@':
      case '&':
      {
        const text: unknown = JSON.parse(line.slice(1))
        if (typeof text !== 'string') {
          log.warn('Expected string stream data', line)
        } else {
          this.processStream(line[0] as StreamType, text)
        }
        return
      }
    }

    log.warn('Unknown output', line)
  }

  processStream(stream: StreamType, text: string) {
    if (stream === StreamType.Console) {
      gdbLog(text)
    } else {
      log.info(stream, text)
    }
  }

  async idle(timeoutMs: number): Promise<boolean> {
    if (await this.idleSignal.wait(timeoutMs)) {
      return true
    }

    log.warn('Launch didn\'t finish in', timeoutMs, 'ms')
    return false
  }
}
