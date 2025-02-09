import { getLog } from '@my/services'

import { MiCommands } from './mi.commands'

const log = getLog('Cortex')

/* eslint-disable @typescript-eslint/no-unused-vars */

/** fixed address of the table containing addresses of base Cortex peripherals */
const ROM_TABLE = 0xE00FF000

const SCS_DEMCR = 0xDFC
const SCS_DEMCR_TRCENA = 1 << 24

const DWT_CTRL = 0

/** do not use, conflicts with PCSAMPLENA */
const DWT_CTRL_CYCEVTENA = 1 << 22

/** folded instruction counter, sends an event every 256 cycles *saved* due to instruction folding, manageable intensity, questionable value */
const DWT_CTRL_FOLDEVTENA = 1 << 21

/** load-store overhead counter, sends an event every 256 extra cycles (more than 1) spent reading and writing, practically unusable */
const DWT_CTRL_LSUEVTENA = 1 << 20

/** sleep counter, implementation defined, PCSAMPLENA seems to be a better option for estimating sleep ratio */
const DWT_CTRL_SLEEPEVTENA = 1 << 19

/** exception overhead counter, sends an event every 256 cycles spent in exception entry/exit */
const DWT_CTRL_EXCEVTENA = 1 << 18

/** instruction counter, sends an event every 256 instructions executed, practically unusable */
const DWT_CTRL_CPIEVTENA = 1 << 17

/** trace interrupt entry/exit, very intensive but usually manageable, especially without PCSAMPLENA */
const DWT_CTRL_EXCTRCENA = 1 << 16

/** PC sampling */
const DWT_CTRL_PCSAMPLENA = 1 << 12

const DWT_CTRL_SYNCTAP_OFF = 0 << 10
const DWT_CTRL_SYNCTAP_16M = 1 << 10
const DWT_CTRL_SYNCTAP_64M = 2 << 10
const DWT_CTRL_SYNCTAP_256M = 3 << 10

const DWT_CTRL_CYCTAP_1K = (cnt: number) => 1 << 9 | ((cnt - 1) & 0xF) << 5 | ((cnt - 1) & 0xF) << 1
const DWT_CTRL_CYCCNTENA = 1 << 0

const ITM_TER = 0xE00
const ITM_TCR = 0xE80
const ITM_TCR_TRACEBUS = (bus: number) => (bus & 0x7F) << 16
const ITM_TCR_GTSFREQ_8K = 2 << 10
const ITM_TCR_TSPRESCALE_64 = 3 << 8
const ITM_TCR_TXENA = 1 << 3
const ITM_TCR_SYNCENA = 1 << 2
const ITM_TCR_TSENA = 1 << 1
const ITM_TCR_ITMENA = 1 << 0

const ITM_LAR = 0xFB0
const ITM_LAR_UNLOCK = 0xC5ACCE55

const TPIU_ACPR = 0x10
const TPIU_SPPR = 0xF0
const TPIU_FFCR = 0x304

/* eslint-enable @typescript-eslint/no-unused-vars */

export interface CortexPeripherals {
  scs: number
  dwt: number
  fpb: number
  itm: number
  tpiu: number
  etm: number
  cti: number
  mtb: number
}

export enum SwvFormat {
  Manchester = 1, Uart = 2,
}

export interface CortexTraceOptions {
  format: SwvFormat
  cpuFrequency: number
  swvFrequency: number
  pcSample?: boolean
  exceptionOverhead?: boolean
  exceptionTrace?: boolean
  traceBusId?: number
}

export class Cortex {
  private peripherals?: CortexPeripherals

  constructor(private readonly mi: MiCommands) {
  }

  async detectPeripherals(): Promise<CortexPeripherals> {
    if (this.peripherals) {
      return this.peripherals
    }

    const mem = await this.mi.readMemory(ROM_TABLE, 32)

    function getPeripheral(offset: number) {
      const addr = mem.readUInt32LE(offset)
      return addr & 1 ? (ROM_TABLE + (addr & ~3)) >>> 0 : 0
    }

    const peripherals: CortexPeripherals = {
      scs: getPeripheral(0),
      dwt: getPeripheral(4),
      fpb: getPeripheral(8),
      itm: getPeripheral(12),
      tpiu: getPeripheral(16),
      etm: getPeripheral(20),
      cti: getPeripheral(24),
      mtb: getPeripheral(28),
    }

    log.debug('ROM table peripherals',
      Object.fromEntries(
        Object.entries(peripherals).map(
          ([k, v]: [string, number]) => [k, v.toString(16)],
        ),
      ),
    )

    return this.peripherals = peripherals
  }

  async modify32(addr: number, mod: (data: number) => number) {
    const buf = await this.mi.readMemory(addr, 4)
    const num = buf.readUInt32LE()
    buf.writeUInt32LE(mod(num))
    await this.mi.writeMemory(addr, buf)
  }

  async read32(addr: number): Promise<number> {
    const buf = await this.mi.readMemory(addr, 4)
    return buf.readUInt32LE()
  }

  async write32(addr: number, word: number) {
    const buf = Buffer.alloc(4)
    buf.writeUInt32LE(word)
    await this.mi.writeMemory(addr, buf)
  }

  async setupTrace(options: CortexTraceOptions) {
    const p = await this.detectPeripherals()

    // enable ITM access
    await this.modify32(p.scs + SCS_DEMCR, n => n | SCS_DEMCR_TRCENA)
    await this.write32(p.itm + ITM_LAR, ITM_LAR_UNLOCK)

    // stop ITM and DWT
    await this.write32(p.itm + ITM_TCR, 0)
    await this.write32(p.dwt + DWT_CTRL, 0)

    // configure TPIU
    await this.write32(p.tpiu + TPIU_FFCR, 0x100)
    await this.write32(p.tpiu + TPIU_SPPR, options.format)
    await this.write32(p.tpiu + TPIU_ACPR, options.cpuFrequency / options.swvFrequency)

    // configure DWT
    await this.write32(p.dwt + DWT_CTRL,
      0
      | (options.exceptionOverhead ? DWT_CTRL_EXCEVTENA : 0)
      | (options.exceptionTrace ? DWT_CTRL_EXCTRCENA : 0)
      | (options.pcSample ? DWT_CTRL_PCSAMPLENA : 0)
      | DWT_CTRL_SYNCTAP_16M
      | DWT_CTRL_CYCTAP_1K(16)
      | DWT_CTRL_CYCCNTENA)

    // configure and enable ITM
    await this.write32(p.itm + ITM_TCR,
      0
      | ITM_TCR_TRACEBUS(options.traceBusId ?? 1)
      | ITM_TCR_TXENA
      | ITM_TCR_SYNCENA
      | ITM_TCR_ITMENA)

    // enable all ITM stimuli
    await this.write32(p.itm + ITM_TER, ~0 >>> 0)
  }

  async setExceptionMask(mask: number) {
    const p = await this.detectPeripherals()

    await this.modify32(p.scs + SCS_DEMCR, n => (n & ~0xFFFF) | mask)
  }
}
