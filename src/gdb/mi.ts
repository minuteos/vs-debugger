import { getLog, getTrace } from '@my/services'
import { camelToKebab, promiseWithResolvers, PromiseWithResolvers, readLines, Signal } from '@my/util'
import { Sema } from 'async-sema'
import { Readable, Writable } from 'stream'
import { promisify } from 'util'

import { MiCommandResult, MiCommands, MiExecStatus, MiNotify, MiStatus } from './mi.commands'
import { MiStreamType } from './mi.events'

const log = getLog('MI')
const traceProto = getTrace('MI-Protocol')
const traceCmd = getTrace('MI-Command')
const traceAsync = getTrace('MI-Async')

const PROMPT = '(gdb) ' // received when GDB goes idle

interface PendingCommand extends PromiseWithResolvers<MiCommandResult> {
  token: number
  command: string
  onStatus?: (status: MiStatus) => void
  notify?: MiNotify[]
  output?: string
}

export class GdbMi extends AsyncDisposableStack {
  private readonly receiverPromise: Promise<void>
  private readonly idleSignal = new Signal()
  readonly command: MiCommands
  private nextToken = 1
  private readonly _send: (command: string) => Promise<void>
  private readonly commandSema = new Sema(1)
  private pendingCommand?: PendingCommand

  constructor(
    private readonly input: Readable,
    output: Writable,
    private readonly callbacks?: {
      stream?: (type: MiStreamType, text: string) => void
      notify?: (notify: MiNotify) => void
      status?: (status: MiStatus) => void
      exec?: (status: MiExecStatus) => void
    },
  ) {
    super()

    this.receiverPromise = this.receiver()
    this.defer(async () => {
      log.debug('Closing output channel')
      await promisify(output.end.bind(output))()
      log.debug('Waiting for receiver to complete')
      await this.receiverPromise
      log.debug('Cleanup complete')
    })

    this.command = new Proxy({} as MiCommands, {
      get: (_, prop: string) =>
        (...args: string[]) => this.execute(prop, ...args),
    })

    this._send = promisify(output.write.bind(output))
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
    traceProto('<', line)

    if (line == PROMPT) {
      this.idleSignal.resolve(true)
      return
    }

    function parseToken() {
      let i
      for (i = 0; i < line.length && line[0] >= '0' && line[i] <= '9'; i++);
      const token = i ? Number(line.substring(0, i)) : undefined
      line = line.substring(i)
      return token
    }

    function parseChar() {
      const ch = line[0]
      line = line.substring(1)
      return ch
    }

    function parseClass() {
      const comma = line.indexOf(',')
      const res = line.substring(0, comma < 0 ? line.length : comma)
      line = comma < 0 ? '' : line.substring(comma)
      return res
    }

    function parseValue(): unknown {
      return parseArrayOrTuple() ?? parseConstant()
    }

    function parseArrayOrTuple() {
      const type = line[0]
      if (type !== '[' && type !== '{') {
        return undefined
      }

      const end = type === '[' ? ']' : '}'
      line = line.substring(1)

      if (line.startsWith(end)) {
        // empty
        line = line.substring(1)
        return type === '[' ? [] : {}
      }

      const res: Record<string, unknown> = {}
      let hasResults = false
      let count = 0
      for (;;) {
        const val = parseValue()
        if (val !== undefined) {
          res[count++] = val
        } else {
          const [n, v] = parseResult()
          if (n) {
            res[n] = v
            hasResults = true
            count++
          }
        }
        if (line.startsWith(end)) {
          break
        } else if (line.startsWith(',')) {
          line = line.substring(1)
        } else {
          error(`',' or '${end}' expected`, line)
          break
        }
      }

      return hasResults ? res : Object.values(res)
    }

    function parseConstant() {
      const s = parseString()
      if (s === undefined) {
        return undefined
      }
      // if numeric representation equals the string representation, consider this a number
      const n = Number(s)
      return String(n) === s ? n : s
    }

    function parseString() {
      if (!line.startsWith('"')) {
        return undefined
      }

      let e = 1
      for (;;) {
        const quote = line.indexOf('"', e)
        if (quote < 0) {
          error('Unterminated quoted string', line)
          line = ''
          return undefined
        }
        // count backslashes before the quote
        let bscnt = 0
        while (quote - bscnt > e && line[quote - bscnt - 1] === '\\') {
          bscnt++
        }
        e = quote + 1
        if (bscnt & 1) {
          // if number of backslashes is odd, the quote is escaped
          continue
        }

        const res = JSON.parse(line.substring(0, e)) as string
        line = line.substring(e)
        return res
      }
    }

    function parseResult(): [string?, unknown?] {
      const eq = line.indexOf('=')
      if (eq < 0) {
        return error('\'=\' expected', [])
      }
      const name = line.substring(0, eq)
      line = line.substring(eq + 1)
      const value = parseValue() ?? error('Failed to parse value', '')
      return [name, value]
    }

    function error<T>(message: string, value: T): T {
      log.error(message, line)
      line = ''
      return value
    }

    const token = parseToken()
    const cmd = this.pendingCommand
    if (token) {
      if (!cmd) {
        log.error('Unexpected token, no pending command', token)
      } else if (cmd.token !== token) {
        log.error('Unexpected token', token, ' != ', cmd.token)
      }
      // continue?
    }

    const type = parseChar()
    switch (type) {
      case '~':
      case '@':
      case '&': {
        const text = parseString() ?? error('Expected string', '')
        if (line) {
          log.error('Garbage after stream data', line)
        }
        if (type === '@' && cmd) {
          cmd.output = (cmd.output ?? '') + text
        }
        this.callbacks?.stream?.(type as MiStreamType, text)
        return
      }

      case '^':
      case '*':
      case '+':
      case '=':
      {
        const res: MiCommandResult = {
          $class: parseClass(),
        }
        while (line.startsWith(',')) {
          line = line.substring(1)
          const [n, v] = parseResult()
          if (n) {
            res[n] = v
          }
        }

        if (type != '^') {
          traceAsync(type, res)
        }

        switch (type) {
          case '^':
            if (!cmd) {
              log.error('Result without pending command')
            } else {
              res.$notify = cmd.notify
              res.$output = cmd.output
              traceCmd('<', cmd.token, cmd.command, res)
              cmd.resolve(res)
            }
            break

          case '*':
            this.callbacks?.exec?.(res)
            break

          case '+':
            cmd?.onStatus?.(res)
            this.callbacks?.status?.(res)
            break

          case '=':
            if (cmd) {
              (cmd.notify ??= []).push(res)
            }
            this.callbacks?.notify?.(res)
            break
        }
        return
      }
    }

    log.warn('Unknown output', token, type, line)
  }

  private async send(line: string): Promise<void> {
    traceProto('>', line)
    await this._send(line + '\n')
  }

  private async execute(command: string, ...args: string[]): Promise<void> {
    const token = this.nextToken++
    traceCmd('>', token, command, args)
    const p = promiseWithResolvers<MiCommandResult>()
    await this.commandSema.acquire()
    this.pendingCommand = {
      ...p,
      command,
      token,
    }
    try {
      await this.send(`${token.toString()}-${camelToKebab(command)} ${args.join(' ')}`)
      await p.promise
    } finally {
      this.pendingCommand = undefined
      this.commandSema.release()
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
