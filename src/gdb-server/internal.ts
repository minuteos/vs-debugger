import { DebugError } from '@my/errors'
import { generateFeaturesXml } from '@my/gdb-server/features'
import { GdbServer, GdbServerOptions } from '@my/gdb-server/gdb-server'
import { DebugTarget } from '@my/interfaces'
import { getLog, getTrace } from '@my/services'
import { getProperty, promiseWithResolvers, splitFirst } from '@my/util'
import { AddressInfo, createServer, Socket } from 'net'
import { Readable } from 'stream'
import { promisify } from 'util'

const log = getLog('GDB-Remote')
const trace = getTrace('GDB-Remote')

const ACK = Buffer.from('+')
const NAK = Buffer.from('-')
const STX = '$'.charCodeAt(0)
const ETX = '#'.charCodeAt(0)
const ESC = '}'.charCodeAt(0)
const INT = 3

const escapeChars = /[#$*}]/g

type MaybeAsync<T> = T | Promise<T>
type GdbResult = string | undefined

/**
 * An internal GDB Remote protocol implementation
 * https://sourceware.org/gdb/current/onlinedocs/gdb.html/Remote-Protocol.html
 */
export abstract class InternalGdbServer<T extends GdbServerOptions> extends GdbServer<T> {
  address!: string
  private readonly connections: Connection<T>[] = []
  abstract getTarget(pid: number): Promise<DebugTarget>

  async start(): Promise<void> {
    const server = createServer()
    const { promise, resolve, reject } = promiseWithResolvers()
    server.once('listening', resolve)
    server.once('error', reject)
    server.on('connection', (sock) => {
      this.connections.push(new Connection(this, sock))
    })
    server.listen(undefined, '127.0.0.1')
    await promise

    const port = (server.address() as AddressInfo).port
    this.address = `127.0.0.1:${port.toString()}`
    log.info('Started listener on', this.address)

    this.defer(() => {
      log.info('Stopping listener on', this.address)
      server.close()
      this.connections.forEach((con) => {
        con.close()
      })
    })
  }

  removeConnection(con: Connection<T>) {
    const i = this.connections.indexOf(con)
    if (i < 0) {
      log.warn('Connection not tracked', con.address)
    } else {
      this.connections.splice(i, 1)
    }
  }
}

class Connection<T extends GdbServerOptions> {
  readonly address: string
  private readonly send: (buf: Buffer) => Promise<void>

  // #region Connection state

  /** Features supported by the client (GDB) */
  private qSupported: string[] = []

  /** Acks disabled for the connection */
  private noAck = false

  /** Extended protocol enabled ('!' command) */
  private extended = false

  /** Default thread for various commands (set by 'H' command) */
  private thread = new Map<string, number>()

  /** Attached target */
  private target?: DebugTarget

  // #endregion

  constructor(readonly owner: InternalGdbServer<T>, readonly socket: Socket) {
    this.address = `${socket.remoteAddress ?? '???'}:${socket.remotePort?.toString() ?? '???'}`
    this.send = promisify((buf: Buffer, cb: (err: Error | null | undefined) => void) => socket.write(buf, cb))

    log.info('New connection from', this.address)

    socket.on('close', () => {
      owner.removeConnection(this)
      log.info('Connection from', this.address, 'closed')
    })

    this.run().catch((err: unknown) => {
      log.error('Socket processing crashed', this.address, err)
      this.close()
    })
  }

  close() {
    log.info('Closing connection from', this.address)
    this.socket.destroySoon()
  }

  private async run(): Promise<void> {
    log.debug('Packet reader started')

    for await (const packet of packetReader(this.socket)) {
      if (isCtrlC(packet)) {
        // special case - stop and send reason
        trace('<! Ctrl+C')
        const reply = await this.handleInterrupt()
        if (reply !== undefined) {
          trace('!>', reply)
          const encoded = encodePacket(reply)
          await this.send(encoded)
        }
        continue
      }

      const payload = extractPayload(packet)
      const chk = calculateChecksum(payload)
      const exp = parseInt(packet.subarray(-2).toString(), 16)
      if (chk != exp) {
        log.warn('Checksum error', chk, exp)
        trace('NAK')
        await this.send(NAK)
      } else {
        const pl = decodePayload(payload)
        if (trace.enabled) {
          trace('<', formatTracePayload(pl))
        }
        if (!this.noAck) {
          trace('ACK')
          await this.send(ACK)
        }
        let reply: GdbResult
        try {
          reply = await this.handle(pl)
        } catch (err) {
          log.error('Command handler crashed', formatTracePayload(pl), err)
          reply = 'E.' + (getProperty(err, 'message')?.toString() ?? JSON.stringify(err))
        }
        if (reply !== undefined) {
          trace('>', reply)
          const encoded = encodePacket(reply)
          await this.send(encoded)
        }
      }
    }

    log.debug('Packet reader ended')
  }

  private registerPlaceholder(i: number) {
    const bits = this.target?.registers.info[i]?.bits ?? 0
    return 'x'.repeat(((bits + 7) / 8) << 1)
  }

  private handleXfer(args: string): string {
    const [type, op, annex, range] = args.split(':')
    const [sOffset, sLength] = range.split(',')
    const offset = parseInt(sOffset, 16)
    const length = parseInt(sLength, 16)
    let data: Buffer | undefined

    switch (type) {
      case 'features':
        if (op === 'read' && annex === 'target.xml') {
          if (!this.target) {
            return 'E99'
          }
          data = generateFeaturesXml(this.target)
        }
        break
    }

    if (!data) {
      throw new DebugError('Unsupported xfer {type}:{op}:{annex}', { type, op, annex })
    }

    return (offset + length >= data.length ? 'l' : 'm')
      + data.toString('binary', offset, offset + length)
  }

  private handleQuery(packet: string): MaybeAsync<string> {
    const [query, args] = splitFirst(packet, /[:,]/)
    switch (query) {
      case 'qSupported':
        this.qSupported = args.split(';')
        return 'PacketSize=10000;vContSupported+;QStartNoAckMode+;qXfer:features:read+;qXfer:memory-map:read+'
      case 'qfThreadInfo':
        if (!this.target?.threads.length) {
          return 'l'
        }
        return 'm' + this.target.threads.map(t => t.id.toString()).join(',')
      case 'qsThreadInfo':
        return 'l'
      case 'qThreadExtraInfo': {
        const id = parseInt(args)
        const thread = this.target?.threads.find(t => t.id === id)
        return Buffer.from(thread?.extraInfo ?? '').toString('hex')
      }
      case 'qAttached':
        return '1'
      case 'qC':
        return 'QC1'
      case 'qSymbol':
        return 'OK' // no symbol querying yet...
      case 'qXfer':
        return this.handleXfer(args)
      default:
        log.warn('Unsupported query', query)
        return '' // correct reply for unknown q-commands
    }
  }

  private handleSet(packet: string): string {
    const [set] = splitFirst(packet, ':')
    switch (set) {
      case 'QStartNoAckMode':
        this.noAck = true
        return 'OK'
      default:
        log.warn('Unsupported set command', set)
        return 'E.unknown command'
    }
  }

  private async handleControlAttach(arg: string): Promise<string> {
    this.target = await this.owner.getTarget(parseInt(arg))
    await this.target.debug.stop()
    return this.gdbStopReason
  }

  private async handleControlContinue(arg: string): Promise<GdbResult> {
    if (!this.target) {
      return 'E99'
    }

    switch (arg[0]) {
      case 'c':
      case 'C':
        await this.target.debug.continue()
        return undefined
      case 's':
      case 'S':
        await this.target.debug.step()
        return this.gdbStopReason
      default:
        throw new DebugError('Unknown vCont argument {arg}', { arg })
    }
  }

  private handleControl(packet: string): MaybeAsync<GdbResult> {
    const [cmd, arg] = splitFirst(packet, /[:;]/)
    switch (cmd) {
      case 'vMustReplyEmpty': return ''
      case 'vAttach': return this.handleControlAttach(arg)
      case 'vCont': return this.handleControlContinue(arg)
      case 'vCont?': return 'vCont;c;C;s;S' // GDB requires C and S to accept vCont at all
      default:
        log.warn('Unsupported command', cmd)
        return '' // correct reply for unknown v-commands
    }
  }

  private handleSetExtended(): string {
    this.extended = true
    return 'OK'
  }

  private async handleDetach(): Promise<string> {
    if (!this.target) {
      return 'E99'
    }
    await this.target.debug.continue()
    this.target = undefined
    return 'OK'
  }

  private async handleReadRegisters(): Promise<string> {
    if (!this.target) {
      return 'E99'
    }
    const values = await this.target.registers.readAll()
    return values.map((v, i) => v?.toString('hex') ?? this.registerPlaceholder(i)).join('')
  }

  private handleSetDefaultThread(packet: string): string {
    this.thread.set(packet[1], parseInt(packet.substring(2)))
    return 'OK'
  }

  private async handleReadMemory(packet: string, encoding: 'hex' | 'binary' = 'hex'): Promise<string> {
    if (!this.target) {
      return 'E99'
    }
    try {
      const [sAddr, sLength] = packet.substring(1).split(',')
      const addr = parseInt(sAddr, 16)
      const len = parseInt(sLength, 16)
      const data = await this.target.memory.read(addr, len)
      return (encoding === 'binary' ? 'b' : '') + data.toString(encoding)
    } catch (err) {
      // GDB expressly states that E. is not an acceptable reply
      log.error('Error while reading memory', err)
      return 'E01'
    }
  }

  private async handleWriteMemory(packet: string, encoding: 'hex' | 'binary' = 'hex'): Promise<string> {
    if (!this.target) {
      return 'E99'
    }
    const [sHdr, sData] = splitFirst(packet.substring(1), ':')
    const [sAddr, sLength] = sHdr.split(',')
    const addr = parseInt(sAddr, 16)
    const len = parseInt(sLength, 16)
    const data = Buffer.from(sData, encoding)
    if (data.length != len) {
      throw new DebugError('Length mismatch: {arg} != {data}', { arg: len, data: data.length })
    }
    await this.target.memory.write(addr, data)
    return 'OK'
  }

  private async handleReadRegister(packet: string): Promise<string> {
    if (!this.target) {
      return 'E99'
    }
    const index = parseInt(packet.substring(1), 16)
    const value = await this.target.registers.read(index)
    return value?.toString('hex') ?? this.registerPlaceholder(index)
  }

  private async handleWriteRegister(packet: string): Promise<string> {
    if (!this.target) {
      return 'E99'
    }
    const [sIndex, sValue] = packet.substring(1).split('=', 2)
    const index = parseInt(sIndex, 16)
    const value = Buffer.from(sValue, 'hex')
    await this.target.registers.write(index, value)
    return 'OK'
  }

  private async handleReset(): Promise<string> {
    if (!this.target) {
      return 'E99'
    }

    await this.target.debug.reset()
    return 'OK'
  }

  private async handleBreakpoint(packet: string): Promise<string> {
    if (!this.target) {
      return 'E99'
    }

    const set = packet.startsWith('Z')
    const [type, sAddr, sKind, ...rest] = packet.substring(1).split(/[,;]/)
    const addr = parseInt(sAddr, 16)
    const kind = parseInt(sKind, 16)

    switch (type) {
      case '1': // hardware breakpoint
        if (rest.length) {
          throw new DebugError('Breakpoint options not supported {options}', { options: rest })
        }
        await this.target.debug.breakpoint(set, addr, kind)
        return 'OK'
      default:
        throw new DebugError('Unsupported breakpoint type {type}', { type })
    }
  }

  private async handleInterrupt(): Promise<GdbResult> {
    if (!this.target) {
      return 'E99'
    }

    await this.target.debug.stop()
    return this.gdbStopReason
  }

  private handle(packet: string): MaybeAsync<GdbResult> {
    switch (packet[0]) {
      case 'q': return this.handleQuery(packet)
      case 'Q': return this.handleSet(packet)
      case 'v': return this.handleControl(packet)

      case '!': return this.handleSetExtended()
      case '?': return this.gdbStopReason
      case 'D': return this.handleDetach()
      case 'g': return this.handleReadRegisters()
      case 'H': return this.handleSetDefaultThread(packet)
      case 'm': return this.handleReadMemory(packet)
      case 'M': return this.handleWriteMemory(packet)
      case 'p': return this.handleReadRegister(packet)
      case 'P': return this.handleWriteRegister(packet)
      case 'R': return this.handleReset()
      case 'x': return this.handleReadMemory(packet, 'binary')
      case 'X': return this.handleWriteMemory(packet, 'binary')
      case 'z': return this.handleBreakpoint(packet)
      case 'Z': return this.handleBreakpoint(packet)

      default:
        log.warn('Unsupported command', packet)
        return 'E.unknown command'
    }
  }

  private get gdbStopReason() {
    const { target } = this
    if (!target) {
      return 'W00' // not attached ("process exited" actually)
    }

    if (!target.threads.length) {
      return 'N' // no threads running
    }

    for (const t of target.threads) {
      if (t.stopReason !== undefined) {
        return 'S' + Buffer.from([t.stopReason]).toString('hex')
      }
    }

    // nothing to return, running
    return ''
  }
}

async function* packetReader(stream: Readable): AsyncIterable<Buffer> {
  const parts: Buffer[] = [] // parts of the incomplete packet
  let final = 0 // number of bytes until the end of the packet, once known

  for await (const blk of stream) {
    if (!Buffer.isBuffer(blk)) {
      throw new Error('Only Buffer stream is supported')
    }

    let block = blk

    while (block.length) {
      if (final) {
        // we know where the end of the packet is
        if (final > block.length) {
          // not enough data in the current block
          final -= block.length
          parts.push(block)
          break
        }

        // packet complete
        const rest = block.subarray(0, final)
        block = block.subarray(final)

        const packet = parts.length
          ? Buffer.concat([...parts, rest])
          : rest
        yield packet

        // reset packet data
        final = 0
        parts.length = 0
        continue
      }

      if (!parts.length) {
        // look for the start of a packet
        if (block[0] !== STX) {
          // not the start of a packet - process and consume
          switch (block[0]) {
            case ACK[0]:
              trace('< ACK')
              break
            case NAK[0]:
              trace('< NAK')
              break
            case INT:
              yield block.subarray(0, 1)
              break
            default:
              trace('?', block.subarray(0, 1))
              break
          }
          block = block.subarray(1)
          continue
        }
      }

      // look for the end of the packet
      const end = block.indexOf(ETX)
      if (end < 0) {
        parts.push(block)
        return
      }

      final = end + 3 // we need the '#' and two more checksum bytes
    }
  }

  if (parts.length) {
    throw new Error('Garbage at end of stream')
  }
}

function isCtrlC(packet: Buffer): boolean {
  return packet.length === 1 && packet[0] === INT
}

function extractPayload(packet: Buffer): Buffer {
  return packet.subarray(1, -3)
}

function calculateChecksum(payload: Buffer): number {
  return payload.reduce((a, n) => (a + n) & 255, 0)
}

function encodePacket(payload: string): Buffer {
  const esc = []
  while (escapeChars.exec(payload)) {
    esc.push(escapeChars.lastIndex - 1)
  }
  const len = Buffer.byteLength(payload)
  const buf = Buffer.alloc(1 + len + esc.length + 3)
  buf.write('$', 0)
  let ss = 0, bs = 1
  for (const se of esc) {
    if (ss != se) {
      buf.write(payload.substring(ss, se), bs, 'binary')
      bs += se - ss
    }
    buf[bs++] = ESC
    buf[bs++] = payload.charCodeAt(se) ^ 0x20
    ss = se + 1
  }
  if (ss < len) {
    buf.write(payload.substring(ss), bs, 'binary')
  }
  buf.write('#', buf.length - 3)
  const chk = calculateChecksum(extractPayload(buf))
  const hex = '0123456789abcdef'
  buf.write(hex[chk >>> 4], buf.length - 2)
  buf.write(hex[chk & 0xf], buf.length - 1)
  return buf
}

function decodePayload(payload: Buffer): string {
  let res = ''
  while (payload.length) {
    const esc = payload.indexOf(ESC)
    if (esc < 0) {
      res += payload.toString('binary')
      break
    }
    payload[esc + 1] = payload[esc + 2] ^ 0x20
    res += payload.toString('binary', 0, esc + 1)
    payload = payload.subarray(esc + 2)
  }
  return res
}

function formatTracePayload(payload: string): string {
  if (payload.startsWith('X')) {
    const [hdr, data] = splitFirst(payload, ':')
    return `${hdr}:<${data.length.toString()} bytes of raw data>`
  }
  return payload
}
