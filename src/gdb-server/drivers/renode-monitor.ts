import { getLog, getTrace } from '@my/services'
import { delay, DisposableContainer, promiseWithResolvers, PromiseWithResolvers, Signal } from '@my/util'
import { Sema } from 'async-sema'
import { createConnection, Socket } from 'net'
import { promisify } from 'util'

const log = getLog('Renode-Monitor')
const trace = getTrace('Renode-Monitor')

// Renode's --port endpoint speaks raw TCP (no telnet IAC) but sprinkles ANSI
// CSI sequences into the output. The end of every monitor reply is a prompt
// of the form "(<context>) " with no trailing newline, where <context> is
// either "monitor" or the current machine name.
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\[[0-?]*[ -/]*[@-~]/g
const PROMPT = /\(([^)\r\n]+)\) $/

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
 * TCP client for Renode's monitor (the "--port" / control endpoint).
 *
 * Speaks the same line-oriented command protocol a user would see in the
 * interactive monitor, with command serialization, ANSI stripping and prompt
 * detection so callers get a clean text response per command.
 */
export class RenodeMonitor extends DisposableContainer {
  private socket?: Socket
  private send?: (chunk: Buffer | string) => Promise<void>
  private readonly sema = new Sema(1)
  private pending?: PendingCommand
  private readonly readySignal = new Signal()
  private context = 'monitor'
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
      await send(command + '\n')

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
    try {
      for await (const chunk of socket) {
        if (!Buffer.isBuffer(chunk)) {
          continue
        }
        // ANSI sequences may straddle chunk boundaries; we strip per-chunk
        // since Renode never splits them across the network in practice.
        const text = chunk.toString('utf8').replace(ANSI_CSI, '')
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

    // No command in flight - this is banner output or async monitor logging.
    const m = PROMPT.exec(text)
    if (m) {
      this.context = m[1]
      this.readySignal.resolve(true)
    }
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
