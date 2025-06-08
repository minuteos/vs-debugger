export interface DebugTarget {
  info: DebugTargetInfo
  debug: DebugTargetControl
  threads: DebugTargetThread[]
  registers: DebugTargetRegisters
  memory: DebugTargetMemory
}

export interface DebugTargetInfo {
  architecture: string
  device: string
  revision?: string
  uid?: string
  fpbComparators?: number
}

export interface DebugTargetControl {
  stop(): Promise<void>
  step(): Promise<void>
  continue(): Promise<void>
  reset(): Promise<void>
  breakpoint(set: boolean, addr: number, kind?: number): Promise<boolean>
}

export enum StopSignal {
  Interrupt = 2,
  IllegalInstruction = 4,
  Trap = 5,
  FPException = 8,
  BusError = 10,
  SegmentationFault = 11,
  Terminated = 15,
}

export interface DebugTargetThread {
  id: number
  stopReason?: StopSignal
  extraInfo?: string
}

export interface DebugTargetRegisters {
  read(index: number): Promise<Buffer | undefined>
  write(index: number, value: Buffer): Promise<void>
  readAll(): Promise<(Buffer | undefined)[]>

  /** Register metadata, can contain holes (undefined) but indexes must match */
  info: (DebugTargetRegisterInfo | undefined)[]

  /** Custom register type specifications */
  types?: DebugTargetRegisterTypeInfo[]
}

export interface DebugTargetRegisterInfo {
  gdbFeature: string
  group: string
  name: string
  bits: number
  type?: string
}

export interface DebugTargetRegisterTypeInfo {
  id: string
  size?: number
  type: 'union' | 'struct' | 'flags'
  fields: DebugTargetRegisterTypeField[]
}

export interface DebugTargetRegisterTypeField {
  name: string
  bit?: number | [number, number]
  type?: string
}

export interface DebugTargetMemory {
  read(address: number, length: number): Promise<Buffer>
  write(address: number, data: Buffer): Promise<void>
}
