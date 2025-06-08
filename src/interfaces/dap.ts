export interface DebugAccessPort {
  readCpuId(): Promise<Buffer>
  readRegister(index: number): Promise<Buffer | undefined>
  writeRegister(index: number, value: Buffer): Promise<void>
  readCoreRegisters(): Promise<(Buffer | undefined)[]>

  readMemory(addr: number, len: number): Promise<Buffer>
  writeMemory(addr: number, data: Buffer): Promise<void>

  stop(): Promise<void>
  step(): Promise<void>
  continue(): Promise<void>
}
