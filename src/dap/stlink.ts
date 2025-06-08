import { DebugError } from '@my/errors'
import { DebugAccessPort } from '@my/interfaces'
import { getLog, getTrace } from '@my/services'
import { findUsbInterface, UsbInterfaceMatch } from '@my/services/usb'
import { DisposableContainer, Signal, throwError } from '@my/util'
import { Duplex } from 'stream'
import { promisify } from 'util'

const log = getLog('STLink-DAP')
const trace = getTrace('STLink-DAP')

enum Command {
  GetVersion = 0xF1,
  Debug = 0xF2,
  Dfu = 0xF3,
  Swim = 0xF4,
  GetCurrentMode = 0xF5,
  GetTargetVoltage = 0xF7,
  GetVersionV3 = 0xFB,
}

enum DfuCommand {
  Exit = 0x07,
}

enum DebugCommand {
  ReadMemory32 = 0x07,
  WriteMemory32 = 0x08,
  WriteMemory8 = 0x0D,
  Exit = 0x21,
  Enter = 0x30,
  ReadIdCodes = 0x31,
  SystemReset = 0x32,
  ReadRegister = 0x33,
  WriteRegister = 0x34,
  WriteDebugRegister = 0x35,
  ReadDebugRegister = 0x36,
  ReadAllRegisters = 0x3A,
  GetLastRwStatus = 0x3B,
  DriveNRST = 0x3D,
  GetLastRwStatus2 = 0x3E,
}

enum DebugEnterMode {
  JtagReset = 0,
  SwdNoReset = 0xa3,
  JtagNoReset = 0xa4,
}

enum DebugRegister {
  DHCSR = 0xE000EDF0,
}

enum DHCSR {
  Key = 0xA05F0000,
  DebugEn = 1,
  CmdHalt = 2,
  CmdStep = 4,
  CmdIntMask = 8,
  StatRegReady = 0x10000,
  StatHalt = 0x20000,
  StatSleep = 0x40000,
  StatLockup = 0x80000,
}

enum SwimCommand {
  Exit = 0x01,
}

enum ErrorReply {
  Ok = 0x80,
  Fault = 0x81,

  GetIdCodeError = 0x09,
  JtagWriteError = 0x0c,
  JtagWriteVerifyError = 0x0d,

  SwdApWait = 0x10,
  SwdApFault = 0x11,
  SwdApError = 0x12,
  SwdApParityError = 0x13,

  SwdDpWait = 0x14,
  SwdDpFault = 0x15,
  SwdDpError = 0x16,
  SwdDpParityError = 0x17,

  SwdApWDataError = 0x18,
  SwdApStickyError = 0x19,
  SwdApStickyOverrunError = 0x1a,

  SwdBadApError = 0x1d,
}

enum Mode {
  Dfu, Mass, Debug, Swim, Bootloader,
}

interface Version {
  stlink: number
  jtag: number
  swim: number
  vid: number
  pid: number
}

type CommandBuilder = (cmd: Buffer) => void
type ExecCommand = number | number[] | CommandBuilder

interface ExecOptions {
  timeout?: number
  checkError?: boolean
  writeData?: Buffer
}

const COMMAND_LEN = 16
const MAX_DATA_LEN = 6144

export class StlinkDebugAccessPort extends DisposableContainer implements DebugAccessPort {
  readonly send: (buf: Buffer) => Promise<void>
  constructor(readonly stream: Duplex) {
    super()
    this.send = promisify(stream.write.bind(stream))
  }

  async connect(): Promise<void> {
    const mode = await this.currentMode()
    log.debug('STLink mode:', Mode[mode])
    let ver = await this.getVersion()
    if (ver.stlink >= 3) {
      ver = await this.getVersionV3()
    }
    log.debug('STLink version:', ver)

    await this.switchMode(Mode.Debug)
  }

  private async switchMode(mode: Mode): Promise<void> {
    let current = await this.currentMode()

    if (current === mode) {
      return
    }

    // exit current mode (if applicable)
    let exitCommand
    switch (current) {
      case Mode.Debug:
        exitCommand = [Command.Debug, DebugCommand.Exit]
        break

      case Mode.Swim:
        exitCommand = [Command.Swim, SwimCommand.Exit]
        break

      case Mode.Dfu:
        exitCommand = [Command.Dfu, DfuCommand.Exit]
        break
    }

    if (exitCommand) {
      log.debug('Exiting mode', Mode[current])
      await this.exec(exitCommand)
    }

    current = await this.currentMode()

    if (current !== mode) {
      let enterCommand

      switch (mode) {
        case Mode.Debug:
          enterCommand = [Command.Debug, DebugCommand.Enter, DebugEnterMode.SwdNoReset]
          break

        default:
          log.error('Don\'t know how to enter mode', Mode[mode])
          break
      }

      if (enterCommand) {
        log.debug('Entering mode', Mode[mode])
        await this.exec(enterCommand, { checkError: true })
      }
      current = await this.currentMode()
    }

    if (current !== mode) {
      log.error('Failed to enter mode', Mode[mode], 'stayed in', Mode[current])
      throw new DebugError('Failed to enter mode {mode}', { mode: Mode[mode] })
    } else {
      log.debug('Entered mode', Mode[mode])
    }
  }

  private async exec(command: ExecCommand, options: ExecOptions & { writeData: Buffer }): Promise<undefined>
  private async exec(command: ExecCommand, options: ExecOptions & { timeout: number }): Promise<Buffer | undefined>
  private async exec(command: ExecCommand, options?: ExecOptions): Promise<Buffer>
  private async exec(command: ExecCommand, options: ExecOptions = {}): Promise<Buffer | undefined> {
    // discard anything that might be in the input
    while (this.stream.read());

    const cmd = Buffer.alloc(COMMAND_LEN)
    if (typeof command === 'number') {
      cmd[0] = command
    } else if (Array.isArray(command)) {
      Buffer.from(command).copy(cmd)
    } else {
      command(cmd)
    }
    trace('>', cmd.toString('hex'))

    await this.send(cmd)

    if (options.writeData) {
      if (trace.enabled) {
        if (options.writeData.length > 64) {
          trace('>>', `${options.writeData.subarray(0, 64).toString('hex')}... (+${String(options.writeData.length - 64)} bytes)`)
        } else {
          trace('>>', options.writeData.toString('hex'))
        }
      }
      await this.send(options.writeData)
      return
    }

    const sig = new Signal<Buffer>()
    this.stream.once('data', sig.resolve)
    try {
      let res: Buffer | undefined
      if (options.timeout) {
        res = await sig.wait(options.timeout)
      } else {
        res = await sig
      }
      if (res) {
        trace('<', res.toString('hex'))

        if (options.checkError) {
          const err: ErrorReply = res[0]
          if (err !== ErrorReply.Ok) {
            const command = Command[cmd[0]]
            const error = ErrorReply[err]
            log.error('Command', command, 'returned error', error)
            throw new DebugError('Command {command} returned error {error}', { command, error })
          }
          res = res.subarray(4)
        }
      }
      return res
    } finally {
      this.stream.removeListener('data', sig.resolve)
    }
  }

  private async getVersion(): Promise<Version> {
    const res = await this.exec(Command.GetVersion)
    const pack = res.readUInt16BE()
    return {
      stlink: pack >>> 12,
      jtag: (pack >>> 6) & 0x3f,
      swim: pack & 0x3f,
      vid: res.readUint16LE(2),
      pid: res.readUint16LE(4),
    }
  }

  private async getVersionV3(): Promise<Version> {
    const res = await this.exec(Command.GetVersionV3)
    return {
      stlink: res[0],
      jtag: res[2],
      swim: res[1],
      vid: res.readUint16LE(8),
      pid: res.readUint16LE(10),
    }
  }

  private async currentMode(): Promise<Mode> {
    // STLink sometimes doesn't respond to the GetCurrentMode command,
    // retry a few times with short timeout
    for (let i = 0; i < 5; i++) {
      const res = await this.exec(Command.GetCurrentMode, { timeout: 100 })
      if (res) {
        return res[0]
      }
    }
    const res = await this.exec(Command.GetCurrentMode, { timeout: 1000 }) ?? throwError(new DebugError('Failed to get current mode from STLink'))
    return res[0]
  }

  private async targetVoltage(): Promise<number> {
    const res = await this.exec(Command.GetTargetVoltage)
    const factor = res.readUint32LE(0)
    const reading = res.readUint32LE(4)
    log.debug('targetVoltage', { factor, reading })
    return 2400 * reading / factor
  }

  async readRegister(index: number): Promise<Buffer | undefined> {
    const res = await this.exec([Command.Debug, DebugCommand.ReadRegister, index], { checkError: true })
    return res
  }

  async writeRegister(index: number, value: Buffer): Promise<void> {
    await this.exec((cmd) => {
      cmd[0] = Command.Debug
      cmd[1] = DebugCommand.WriteRegister
      cmd[2] = index
      value.copy(cmd, 3)
    }, { checkError: true })
  }

  async readCoreRegisters(): Promise<(Buffer | undefined)[]> {
    const res = await this.exec([Command.Debug, DebugCommand.ReadAllRegisters], { checkError: true })
    return [res]
  }

  async readMemory(addr: number, length: number): Promise<Buffer> {
    // we cannot use & ~3 safely due to the way JS handles binary operations
    // (automatically converting operands to *signed* 32-bit integers)
    let start = addr - (addr & 3)
    let end = addr + length + 3
    end -= end & 3
    const chunks = []

    while (start < end) {
      const len = Math.min(end - start, MAX_DATA_LEN)
      const block = await this.exec((cmd) => {
        cmd[0] = Command.Debug
        cmd[1] = DebugCommand.ReadMemory32
        cmd.writeUInt32LE(start, 2)
        cmd.writeUInt16LE(len, 6)
      })
      chunks.push(block)
      start += len
    }
    const res = Buffer.concat(chunks)
    return res.subarray(0, length)
  }

  private async execWriteMem(wr: DebugCommand, addr: number, len: number, data: Buffer): Promise<[number, Buffer]> {
    await this.exec((cmd) => {
      cmd[0] = Command.Debug
      cmd[1] = wr
      cmd.writeUInt32LE(addr, 2)
      cmd.writeUInt16LE(len, 6)
    }, { writeData: data.subarray(0, len) })
    return [addr + len, data.subarray(len)]
  }

  async writeMemory(addr: number, data: Buffer): Promise<void> {
    if (addr & 3) {
      // write unaligned leading bytes
      [addr, data] = await this.execWriteMem(DebugCommand.WriteMemory8,
        addr, 4 - (addr & 3), data)
    }

    while (data.length >= 4) {
      // write aligned words, max 6144 bytes at a time
      [addr, data] = await this.execWriteMem(DebugCommand.WriteMemory32,
        addr, Math.min(data.length - (data.length & 3), MAX_DATA_LEN), data)
    }

    if (data.length) {
      // write unaligned trailing bytes
      await this.execWriteMem(DebugCommand.WriteMemory8,
        addr, data.length, data)
    }
  }

  async readCpuId(): Promise<Buffer> {
    const res = await this.exec([Command.Debug, DebugCommand.ReadIdCodes], { checkError: true })
    return res
  }

  stop(): Promise<void> {
    return this.writeDebug(DebugRegister.DHCSR, DHCSR.Key | DHCSR.CmdHalt | DHCSR.DebugEn)
  }

  step(): Promise<void> {
    return this.writeDebug(DebugRegister.DHCSR, DHCSR.Key | DHCSR.CmdStep | DHCSR.DebugEn)
  }

  continue(): Promise<void> {
    return this.writeDebug(DebugRegister.DHCSR, DHCSR.Key | DHCSR.DebugEn)
  }

  reset(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async writeDebug(addr: DebugRegister, value: number): Promise<void> {
    await this.exec((cmd) => {
      cmd[0] = Command.Debug
      cmd[1] = DebugCommand.WriteDebugRegister
      cmd.writeUInt32LE(addr >>> 0, 2)
      cmd.writeUInt32LE(value >>> 0, 6)
    }, { checkError: true })
  }

  static async fromUsb(interfaceMatch: UsbInterfaceMatch): Promise<StlinkDebugAccessPort> {
    const usb = await findUsbInterface(interfaceMatch)
      ?? throwError(new Error('Failed to autodetect STLink Debug port.\n\nAre you sure you have a STLink connected?'))

    const stream = new Duplex()
    const res = new StlinkDebugAccessPort(stream)

    try {
      log.info('Found USB interface', usb)
      res.use(await usb.claim())
      res.use(usb.inToStream(stream))
      res.use(usb.streamToOut(stream))
    } catch (err) {
      await res[Symbol.asyncDispose]()
      throw err
    }

    return res
  }
}
