export interface SvdRegisterProperties {
  size: number
  access: SvdAccess
  protection: SvdProtection
  resetMask: number
  resetValue: number
}

export type SvdAccess = 'read-only' | 'write-only' | 'read-write' | 'writeOnce' | 'read-writeOnce'

export type SvdProtection = 's' | 'n' | 'p'

export interface Svd {
  cacheVersion: number
  version: string | number

  name: string
  description: string
  vendor?: string
  vendorId?: string
  series?: string
  licenseText?: string

  cpu?: SvdCpu
  headerSystemFilename?: string
  headerDefinitionsPrefix?: string
  addressUnitBits: number
  width: number

  peripherals: SvdPeripheral[]
}

export interface SvdCpu {
  name: string
  revision: string
  endian: 'little' | 'big'

  // cortex specic flags
  fpuPresent?: boolean
  mpuPresent?: boolean
  nvicPrioBits?: number
  vendorSystickConfig?: boolean
}

export interface SvdPeripheral extends Partial<SvdRegisterProperties> {
  name: string
  description?: string
  groupName?: string
  prependToName?: string
  appendToName?: string
  baseAddress: number
  addressBlocks: SvdAddressBlock[]
  interrupts: SvdInterrupt[]
  registers: SvdRegister[]
}

export interface SvdAddressBlock {
  offset: number
  size: number
  usage: SvdUsage
  protection: SvdProtection
}

export type SvdUsage = 'registers' | 'buffer' | 'reserved'

export interface SvdInterrupt {
  name: number
  description: string
  value: number
}

export interface SvdRegister extends SvdRegisterProperties {
  name: string
  description: string
  displayName?: string
  addressOffset: number
  fields?: SvdField[]
}

export interface SvdField {
  name: string
  description: string
  bitOffset: number
  bitWidth: number
}
