import { LaunchConfiguration, StlinkSmuConfiguration } from '@my/configuration'
import { getLog } from '@my/services'
import { findSerialPort } from '@my/services/serial'
import { LineReader, PromiseWithResolvers, promiseWithResolvers } from '@my/util'
import { throwError } from '@my/util'
import { Sema } from 'async-sema'
import { SerialPort } from 'serialport'
import { promisify } from 'util'

import { Smu } from './smu'

const log = getLog('STLink-SMU')

const ST_VID = 0x0483
const STLINK_V3PWR_PID = 0x3757

const knownDeviceIds = [
  { vid: ST_VID, pid: STLINK_V3PWR_PID },
]

interface PendingCommand extends PromiseWithResolvers<string> {
  command: string
}

export class StlinkSmu extends Smu {
  private _send?: (chunk: unknown, encoding?: BufferEncoding) => Promise<void>
  private readonly commandSema = new Sema(1)
  private done = false
  private pendingCommand?: PendingCommand

  get output() { return this.config.output ?? 'vout' }
  get voltage() { return this.config.voltage ?? 3.0 }

  constructor(readonly config: StlinkSmuConfiguration, readonly launchConfig: LaunchConfiguration) {
    super()
  }

  async connect(): Promise<void> {
    const path = this.config.port
      ?? await findSerialPort({
        deviceId: knownDeviceIds,
        index: 1,
        ...this.config,
      })
      ?? throwError('Failed to autodetect STLink V3-PWR SMU port.\n\nAre you sure you have one connected?')

    const ser = new SerialPort({
      path,
      baudRate: 115200, // doesn't really matter
      autoOpen: false,
    })

    log.info('Connecting to STLink-V3PWR', path)
    await promisify(ser.open.bind(ser))()
    log.info('Connected to STLink-V3PWR', path)

    const receiver = this.receiver(ser)
    this._send = promisify(ser.write.bind(ser))

    this.defer(async () => {
      this.done = true
      log.info('Disconnecting from STLink-V3PWR', path)
      await promisify(ser.close.bind(ser))()
      log.info('Disconnected from STLink-V3PWR', path)
      await receiver
      log.info('Cleanup complete')
    })

    // disable unnecessary prompt
    await this.execute('power_monitor')
    // set the optimal format
    await this.execute('format', 'bin_hexa')
    // configure output voltage
    await this.execute('volt', this.output, this.voltage)

    if (this.config.startPowerOn) {
      await this.power(true)
    }

    if (this.config.stopPowerOff) {
      this.defer(() => this.power(false))
    }
  }

  async power(state: boolean) {
    await this.execute('pwr', this.output, state)
  }

  private async receiver(ser: SerialPort) {
    log.info('Starting receiver')
    try {
      // cannot use readLines directly because we'll need to fall back to binary when streaming
      const lr = new LineReader()
      for await (const chunk of ser) {
        for (const lbuf of lr.processAny(chunk)) {
          if (lbuf.length) {
            const line = lbuf.toString()
            log.trace('<', line.toString())
            if (line.startsWith('ack ')) {
              this.pendingCommand?.resolve(line.substring(4))
            }
          }
        }
      }
      log.info('Receiver finished')
    } catch (error) {
      if (!this.done) {
        log.error('Receiver failed', error)
      } else {
        log.info('Receiver stopped')
      }
    }
  }

  private async execute(...args: unknown[]) {
    if (!this._send) {
      throw new Error('SMU not connected')
    }

    function formatArg(arg: unknown) {
      if (typeof arg === 'number') {
        return Math.round(arg * 1000).toString() + 'm'
      }
      if (typeof arg === 'boolean') {
        return arg ? 'on' : 'off'
      }
      return String(arg)
    }

    const p = promiseWithResolvers<string>()
    await this.commandSema.acquire()
    try {
      const command = args.map(formatArg).join(' ')
      log.trace('>', command)
      this.pendingCommand = {
        ...p, command,
      }
      await this._send(command + '\n')
      const timeout = setTimeout(() => {
        p.reject(new Error('SMU command timed out'))
      }, 5000)
      await p.promise
      clearTimeout(timeout)
    } finally {
      this.pendingCommand = undefined
      this.commandSema.release()
    }
  }
}
