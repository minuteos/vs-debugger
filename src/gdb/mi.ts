import { MiError } from '@my/errors'
import { getLog, getTrace } from '@my/services'
import { camelToKebab, DisposableContainer, kebabToCamel, promiseWithResolvers, PromiseWithResolvers, readLines, Signal } from '@my/util'
import { Sema } from 'async-sema'
import { Readable, Writable } from 'stream'
import { promisify } from 'util'

import { MiCommandMaybeErrorResult, MiCommandResult, MiCommands, MiExecStatus, MiNotify, MiResult, MiStatus } from './mi.commands'
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
  console?: string
}

export class GdbMi extends DisposableContainer {
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

    this.command = new Proxy({
      console(...command: string[]) {
        return this.interpreterExec('console', command.join(' '))
      },

      monitor(...command: string[]) {
        return this.console('monitor', ...command)
      },

      async readMemory(addr: number, len: number) {
        const res = await this.dataReadMemoryBytes(addr, len)
        const buf = Buffer.alloc(len)
        for (const { offset, contents } of res.memory) {
          buf.write(contents, parseInt(offset), 'hex')
        }
        return buf
      },

      async writeMemory(addr: number, data: Buffer) {
        await this.dataWriteMemoryBytes(addr, data.toString('hex'))
      },
    } as MiCommands, {
      get: (target, prop: keyof MiCommands) =>
        target[prop] as unknown ?? ((...args: string[]) => this.execute(prop, ...args)),
    })

    this._send = promisify(output.write.bind(output))
  }

  private async receiver(): Promise<void> {
    log.debug('Starting receiver')
    try {
      for await (const lineBuf of readLines(this.input, { maximumLineLength: 1024 * 1024 })) {
        this.process(String(lineBuf))
      }

      log.debug('Receiver finished')
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
      for (i = 0; i < line.length && line[i] >= '0' && line[i] <= '9'; i++);
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
      return parseArray() ?? parseTuple() ?? parseConstant()
    }

    function parseArray(): unknown[] | undefined {
      if (!line.startsWith('[')) {
        return undefined
      }

      const res = []
      while (hasElements('[', ']')) {
        const val = parseValue()
        if (val !== undefined) {
          res.push(val)
        } else {
          const [n, v] = parseResult()
          if (n) {
            // store the array element name as an extra property in the target object
            if (typeof v === 'object' && v) {
              (v as Record<string, unknown>).$type = n
            }
            res.push(v)
          }
        }
      }

      return res
    }

    function parseTuple(): Record<string, unknown> | undefined {
      if (!line.startsWith('{')) {
        return undefined
      }

      const res: Record<string, unknown> = {}
      while (hasElements('{', '}')) {
        const [n, v] = parseResult()
        if (n) {
          res[n] = v
        }
      }

      return res
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
      return [kebabToCamel(name), value]
    }

    function error<T>(message: string, value?: T): T {
      log.error(message, line)
      line = ''
      return value as T
    }

    function hasElements(start: string, end: string): boolean {
      if (line.startsWith(start)) {
        if (line[1] === end) {
          line = line.substring(2)
          return false
        }
        line = line.substring(1)
        return true
      }

      if (line.startsWith(end)) {
        line = line.substring(1)
        return false
      }

      if (line.startsWith(',')) {
        line = line.substring(1)
        return true
      }

      error(`',' or '${end}' expected`)
      return false
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
        if (type === '~' && cmd) {
          cmd.console = (cmd.console ?? '') + text
        }
        this.callbacks?.stream?.(type as MiStreamType, text)
        return
      }

      case '^':
      case '*':
      case '+':
      case '=':
      {
        const res: MiResult = {
          $class: parseClass(),
        }
        while (line.startsWith(',')) {
          line = line.substring(1)
          const val = parseValue()
          if (val !== undefined) {
            if (typeof val === 'object' && !line.length && Object.keys(res).length === 1) {
              // single object result, merge it into res
              Object.assign(res, val)
            } else {
              (res.$results ??= []).push(val)
            }
          } else {
            const [n, v] = parseResult()
            if (n) {
              res[n] = v
            }
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
              const cmdRes = res as MiCommandMaybeErrorResult
              cmdRes.$notify = cmd.notify
              cmdRes.$output = cmd.output
              cmdRes.$console = cmd.console
              traceCmd('<', cmd.token, cmd.command, res)
              if (cmdRes.$class === 'error') {
                cmd.reject(new MiError(cmdRes))
              } else {
                cmd.resolve(cmdRes)
              }
            }
            break

          case '*':
            this.callbacks?.exec?.(res as MiExecStatus)
            break

          case '+':
            cmd?.onStatus?.(res as unknown as MiStatus)
            this.callbacks?.status?.(res as unknown as MiStatus)
            break

          case '=':
            if (cmd) {
              (cmd.notify ??= []).push(res as unknown as MiNotify)
            }
            this.callbacks?.notify?.(res as unknown as MiNotify)
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

  async execute(command: string, ...args: unknown[]): Promise<MiCommandResult> {
    function formatArg(arg: unknown): string[] {
      if (arg === null || arg === undefined) {
        return []
      }

      if (typeof arg === 'object') {
        // generate options
        const argSet: string[] = []
        for (const [k, v] of Object.entries(arg)) {
          if (v === undefined || v === false) {
            // skip undefined/false option args
            continue
          }

          const opt = camelToKebab(k)
          if (k.length === 1) {
            argSet.push(`-${opt}`)
          } else {
            argSet.push(`--${opt}`)
          }

          if (v !== true) {
            argSet.push(...formatArg(v))
          }
        }

        return argSet
      }

      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      let str = arg.toString()

      if (/[\s'"]/.exec(str)) {
        str = `"${str.replaceAll('"', '\\"')}"`
      }

      return [str]
    }

    const token = this.nextToken++
    const p = promiseWithResolvers<MiCommandResult>()
    await this.commandSema.acquire()
    this.pendingCommand = {
      ...p,
      command,
      token,
    }

    const statusIndex = args.findIndex(a => typeof a === 'function')
    if (statusIndex >= 0) {
      this.pendingCommand.onStatus = args[statusIndex] as (status: MiStatus) => void
      args.splice(statusIndex, 1)
    }

    traceCmd('>', token, command, args)
    try {
      await this.send(`${token.toString()}-${camelToKebab(command)} ${args.flatMap(formatArg).join(' ')}`)
      return await p.promise
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
