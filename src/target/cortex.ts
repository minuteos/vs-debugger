import { DebugError } from '@my/errors'
import { DebugAccessPort, DebugTarget, DebugTargetControl, DebugTargetInfo, DebugTargetMemory, DebugTargetRegisterInfo, DebugTargetRegisters, DebugTargetThread, StopSignal } from '@my/interfaces'
import { range } from '@my/util'

const FP_COMP0 = 0xE0002008

export class Cortex implements DebugTarget {
  constructor(readonly dap: DebugAccessPort, readonly info: DebugTargetInfo) {
  }

  private registerCache: (Buffer | undefined)[] = []

  readonly debug: DebugTargetControl = {
    stop: async () => {
      this.registerCache = []
      await this.dap.stop()
      this.threads[0].stopReason = StopSignal.Interrupt
    },

    step: async () => {
      this.registerCache = []
      await this.dap.step()
      this.threads[0].stopReason = StopSignal.Trap
    },

    continue: async () => {
      this.registerCache = []
      await this.dap.continue()
      this.threads[0].stopReason = undefined
    },

    reset: () => Promise.resolve(), // TODO

    breakpoint: async (set, addr) => {
      const { fpbComparators } = this.info
      if (!fpbComparators) {
        if (set) {
          throw new DebugError('No FPB comparators available')
        } else {
          return false
        }
      }

      const fpb = await this.dap.readMemory(FP_COMP0, fpbComparators * 4)

      const baseAddr = addr & 0x3FFFFFFC
      const halfWord = ((addr & 2) || 1) << 30
      let match, matchCmp = 0, empty

      // first try to find a comparator that already matches
      for (let i = 0; i < fpb.length; i += 4) {
        const cmp = fpb.readUInt32LE(i)
        if (cmp & 1) {
          empty ??= i
          fpb.writeUInt32LE(0, i)
        } else if ((cmp & 0x3FFFFFFFC) === baseAddr) {
          match = i
          matchCmp = cmp
          break
        }
      }

      let wr
      if (set) {
        wr = match ?? empty
        if (wr === undefined) {
          throw new DebugError('All {fpbComparators} FPB comparators used', { fpbComparators })
        }

        fpb.writeUInt32LE(matchCmp | baseAddr | halfWord | 1, wr)
      } else {
        if (!match || !(matchCmp & halfWord)) {
          // breakpoint wasn't set
          return false
        }

        wr = match
        matchCmp &= ~halfWord
        if (matchCmp >>> 30) {
          // other halfword is still set
          fpb.writeUInt32LE(matchCmp, wr)
        } else {
          // clear the comparator
          fpb.writeUInt32LE(0, wr)
        }
      }

      await this.dap.writeMemory(FP_COMP0 + wr, fpb.subarray(wr, 4))
      return true
    },
  }

  readonly threads: DebugTargetThread[] = [
    {
      id: 1,
      stopReason: undefined,
      extraInfo: 'Core Thread',
    },
  ]

  readonly registers: DebugTargetRegisters = {
    info: [...coreRegisters, ...fpuRegisters],
    types: [
      {
        id: 'apsr',
        type: 'flags',
        size: 4,
        fields: [
          { name: 'n', bit: 31 },
          { name: 'z', bit: 30 },
          { name: 'c', bit: 29 },
          { name: 'v', bit: 28 },
          { name: 'q', bit: 27 },
          { name: 'ge', bit: [16, 19] },
        ],
      },
      {
        id: 'ipsr',
        type: 'flags',
        size: 4,
        fields: [
          { name: 'exception', bit: [0, 8] },
        ],
      },
      {
        id: 'epsr',
        type: 'flags',
        size: 4,
        fields: [
          { name: 'thumb', bit: 24 },
          { name: 'b', bit: 21 },
          { name: 'it', bit: [10, 15] },
          { name: 'it2', bit: [25, 27] },
        ],
      },
      {
        id: 'xpsr',
        type: 'union',
        fields: [
          { name: 'apsr', type: 'apsr' },
          { name: 'ipsr', type: 'ipsr' },
          { name: 'epsr', type: 'epsr' },
        ],
      },
      {
        id: 'control',
        type: 'flags',
        size: 1,
        fields: [
          { name: 'npriv', bit: 0 },
          { name: 'spsel', bit: 1 },
          { name: 'fpca', bit: 2 },
          { name: 'sfpa', bit: 3 },
        ],
      },
      {
        id: 'spr',
        type: 'struct',
        size: 4,
        fields: [
          { name: 'control', type: 'control', bit: [24, 31] },
          { name: 'basepri', type: 'uint', bit: [0, 7] },
          { name: 'primask', bit: 0 },
          { name: 'faultmask', bit: 8 },
        ],
      },
    ],

    read: async i => (await this.requireRegisters(i))[i],
    readAll: async () => await this.requireRegisters(),
    write: (i, value) => this.dap.writeRegister(i, value),
  }

  readonly memory: DebugTargetMemory = {
    read: (addr, len) => this.dap.readMemory(addr, len),
    write: (addr, data) => this.dap.writeMemory(addr, data),
  }

  private async requireRegisters(single?: number): Promise<(Buffer | undefined)[]> {
    const { registerCache } = this
    const all = single === undefined

    if (!all && registerCache[single]) {
      // required register already loaded
      return registerCache
    }

    registerCache.length = this.registers.info.length
    const missing = registerCache.findIndex(x => !x)
    if (missing < 0) {
      // all registers already loaded
      return registerCache
    }

    if ((all || single < coreRegisters.length) && missing < coreRegisters.length) {
      // load core registers at once
      registerCache.splice(0, coreRegisters.length, ...await this.dap.readCoreRegisters())
    }

    if (!all && single >= coreRegisters.length) {
      // load just the one register
      registerCache[single] = await this.dap.readRegister(single)
    } else {
      // load all register without known values
      const allValues = await Promise.all(registerCache.map((r, i) => r ? r : this.dap.readRegister(i)))
      registerCache.splice(0, registerCache.length, ...allValues)
    }

    return this.registerCache
  }
}

const coreRegisters: (DebugTargetRegisterInfo | undefined)[] = [
  ...range(13).map(n => ({
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: `r${n.toString()}`,
    group: 'general',
    bits: 32,
  })),
  {
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: 'sp',
    group: 'general',
    bits: 32,
    type: 'data_ptr',
  },
  {
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: 'lr',
    group: 'core',
    bits: 32,
    type: 'code_ptr',
  },
  {
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: 'pc',
    group: 'core',
    bits: 32,
    type: 'code_ptr',
  },
  {
    // 0x10
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: 'xpsr',
    group: 'system',
    type: 'xpsr',
    bits: 32,
  },
  {
    // 0x11
    gdbFeature: 'org.gnu.gdb.arm.m-system',
    name: 'msp',
    group: 'system',
    bits: 32,
    type: 'data_ptr',
  },
  {
    // 0x12
    gdbFeature: 'org.gnu.gdb.arm.m-system',
    name: 'psp',
    group: 'system',
    bits: 32,
    type: 'data_ptr',
  },
  undefined, // 0x13
  {
    // 0x14
    gdbFeature: 'org.gnu.gdb.arm.m-system',
    name: 'spr',
    group: 'system',
    bits: 32,
    type: 'spr',
  },
]

const fpuRegisters: (DebugTargetRegisterInfo | undefined)[] = [
  ...range(0x15, 0x1F - 0x15).map(() => undefined),
  {
    // 0x1F
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: 'fpscr',
    group: 'float',
    bits: 32,
  },
  ...range(32).map(n => ({
    gdbFeature: 'org.gnu.gdb.arm.m-profile',
    name: `s${n.toString()}`,
    group: 'float',
    bits: 32,
    type: 'float',
  })),
]
