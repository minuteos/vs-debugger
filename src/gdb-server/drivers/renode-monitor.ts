import { getLog, getTrace } from '@my/services'
import { delay, DisposableContainer, promiseWithResolvers, PromiseWithResolvers, Signal } from '@my/util'
import { Sema } from 'async-sema'
import { createConnection, Socket } from 'net'
import { promisify } from 'util'

const log = getLog('Renode-Monitor')
const trace = getTrace('Renode-Monitor')

// Renode's -P endpoint is a Telnet server (it logs "Monitor available in
// telnet mode"). It negotiates options on connect and emits IAC GA after
// every prompt, so the bytes must go through a Telnet filter before any
// text parsing. We also pass `-p` to renode so there are no ANSI codes.
//
// Each reply ends with a prompt of the form "(<context>) " with no trailing
// newline, where <context> is "monitor" or the active machine name. Trailing
// spaces are tolerated for robustness across renode versions.
const PROMPT = /\(([^)\r\n]+)\) *$/

// Keep enough recent banner text to spot the first prompt without growing
// unbounded if renode logs to the monitor connection before any command.
const BANNER_WINDOW = 4096

// Telnet protocol bytes (RFC 854). Plain constants rather than an enum so
// they compare cleanly against raw buffer bytes under strict lint rules.
const TN_SE = 240
const TN_SB = 250
const TN_WILL = 251
const TN_WONT = 252
const TN_DO = 253
const TN_DONT = 254
const TN_IAC = 255

interface PendingCommand extends PromiseWithResolvers<string> {
  command: string
  buffer: string
}

interface RenodeMonitorOptions {
  host: string
  port: number

  /** Maximum time to wait for the control port to accept a connection */
  connectTimeoutMs?: number

  /** Maximum time to wait for a single command's prompt response */
  commandTimeoutMs?: number
}

/**
 * Telnet client for Renode's monitor (the "-P" / control endpoint).
 *
 * Handles Telnet option negotiation transparently and exposes the same
 * line-oriented command protocol a user sees in the interactive monitor,
 * with command serialization and prompt detection so callers get one clean
 * text response per command.
 */
export class RenodeMonitor extends DisposableContainer {
  private socket?: Socket
  private send?: (chunk: Buffer | string) => Promise<void>
  private readonly sema = new Sema(1)
  private pending?: PendingCommand
  private readonly readySignal = new Signal()
  private context = 'monitor'
  private banner = ''
  private done = false

  constructor(private readonly opts: RenodeMonitorOptions) {
    super()
  }

  /** Current monitor context (e.g. "monitor" or the active machine name). */
  get currentContext() { return this.context }

  /**
   * Opens the TCP connection, retrying until Renode's control port is
   * accepting connections, then waits for the first prompt.
   */
  async connect(): Promise<void> {
    const { host, port, connectTimeoutMs = 10000 } = this.opts
    const deadline = Date.now() + connectTimeoutMs

    let socket: Socket | undefined
    while (!socket) {
      try {
        socket = await tryConnect(host, port)
      } catch (err) {
        if (Date.now() >= deadline) {
          throw new Error(`Failed to connect to Renode monitor at ${host}:${port.toString()}: ${String(err)}`)
        }
        await delay(100)
      }
    }

    log.debug('Connected to monitor', host + ':' + port.toString())
    this.socket = socket
    this.send = promisify(socket.write.bind(socket))

    const receiver = this.receiver(socket)
    this.defer(async () => {
      this.done = true
      socket.destroy()
      await receiver
    })

    // Wait for the initial banner + prompt before letting commands through.
    if (await this.readySignal.wait(connectTimeoutMs) === undefined) {
      throw new Error('Timed out waiting for Renode monitor prompt')
    }
  }

  /**
   * Sends a command to the monitor and resolves with its textual response,
   * stripped of the echoed command line and the trailing prompt.
   */
  async execute(command: string, timeoutMs?: number): Promise<string> {
    if (!this.send) {
      throw new Error('Renode monitor not connected')
    }

    const send = this.send
    const effectiveTimeoutMs = timeoutMs ?? this.opts.commandTimeoutMs ?? 30000

    await this.sema.acquire()
    try {
      const pending: PendingCommand = {
        command,
        buffer: '',
        ...promiseWithResolvers<string>(),
      }
      this.pending = pending

      trace('>', command)
      await send(command + '\r\n') // Telnet line terminator

      const timeout = setTimeout(() => {
        pending.reject(new Error(`Renode monitor command timed out: ${command}`))
      }, effectiveTimeoutMs)
      try {
        return await pending.promise
      } finally {
        clearTimeout(timeout)
      }
    } finally {
      this.pending = undefined
      this.sema.release()
    }
  }

  /**
   * Best-effort graceful shutdown: tells Renode to exit and swallows the
   * resulting timeout/disconnect, since both indicate the process is gone.
   */
  async quit(timeoutMs = 2000): Promise<void> {
    if (!this.send || this.done) {
      return
    }
    try {
      await this.execute('quit', timeoutMs)
    } catch (err) {
      log.debug('Quit command did not complete cleanly', err)
    }
  }

  private async receiver(socket: Socket): Promise<void> {
    log.debug('Starting monitor receiver')
    const telnet = new TelnetFilter(data => socket.write(data))
    try {
      for await (const chunk of socket) {
        if (!Buffer.isBuffer(chunk)) {
          continue
        }
        const clean = telnet.process(chunk)
        if (!clean.length) {
          continue
        }
        const text = clean.toString('utf8')
        trace('<', text)
        this.consume(text)
      }
      log.debug('Monitor receiver finished')
    } catch (err) {
      if (!this.done) {
        log.error('Monitor receiver failed', err)
      }
    } finally {
      this.pending?.reject(new Error('Renode monitor disconnected'))
      this.readySignal.reject(new Error('Renode monitor disconnected'))
    }
  }

  private consume(text: string) {
    const pending = this.pending
    if (pending) {
      pending.buffer += text
      const m = PROMPT.exec(pending.buffer)
      if (m) {
        this.context = m[1]
        const body = pending.buffer.slice(0, m.index)
        pending.resolve(stripEcho(body, pending.command))
      }
      return
    }

    // No command in flight - this is the connect-time banner. Accumulate a
    // bounded window so a prompt split across chunks is still detected.
    this.banner = (this.banner + text).slice(-BANNER_WINDOW)
    const m = PROMPT.exec(this.banner)
    if (m) {
      this.context = m[1]
      this.banner = ''
      this.readySignal.resolve(true)
    }
  }
}

/**
 * Minimal Telnet stream filter: strips IAC command sequences (including the
 * GA that Renode emits after each prompt), refuses all option negotiation so
 * the server stops asking, and unescapes literal 0xFF. Partial sequences are
 * carried over across chunk boundaries.
 */
class TelnetFilter {
  private leftover = Buffer.alloc(0)

  constructor(private readonly respond: (data: Buffer) => void) {}

  process(input: Buffer): Buffer {
    const bytes = this.leftover.length ? Buffer.concat([this.leftover, input]) : input
    this.leftover = Buffer.alloc(0)

    const out: number[] = []
    let i = 0
    while (i < bytes.length) {
      const b = bytes[i]
      if (b !== TN_IAC) {
        out.push(b)
        i++
        continue
      }

      if (i + 1 >= bytes.length) {
        this.leftover = bytes.subarray(i)
        break
      }

      const cmd = bytes[i + 1]
      if (cmd === TN_IAC) {
        out.push(TN_IAC) // escaped literal 0xFF
        i += 2
      } else if (cmd === TN_SB) {
        // Subnegotiation: skip until IAC SE.
        let j = i + 2
        while (j + 1 < bytes.length && !(bytes[j] === TN_IAC && bytes[j + 1] === TN_SE)) {
          j++
        }
        if (j + 1 >= bytes.length) {
          this.leftover = bytes.subarray(i)
          break
        }
        i = j + 2
      } else if (cmd === TN_WILL || cmd === TN_WONT || cmd === TN_DO || cmd === TN_DONT) {
        if (i + 2 >= bytes.length) {
          this.leftover = bytes.subarray(i)
          break
        }
        const opt = bytes[i + 2]
        // Refuse everything to terminate negotiation without loops.
        if (cmd === TN_DO) {
          this.respond(Buffer.from([TN_IAC, TN_WONT, opt]))
        } else if (cmd === TN_WILL) {
          this.respond(Buffer.from([TN_IAC, TN_DONT, opt]))
        }
        i += 3
      } else {
        // Other 2-byte commands (GA, NOP, ...) carry no payload - drop them.
        i += 2
      }
    }
    return Buffer.from(out)
  }
}

function tryConnect(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    const onError = (err: Error) => {
      socket.destroy()
      reject(err)
    }
    socket.once('error', onError)
    socket.once('connect', () => {
      socket.off('error', onError)
      resolve(socket)
    })
  })
}

function stripEcho(body: string, command: string): string {
  // Renode echoes the command back as the first line of the response.
  const lines = body.split('\n')
  if (lines[0]?.trimEnd() === command) {
    lines.shift()
  }
  return lines.join('\n').replace(/\s+$/, '')
}
