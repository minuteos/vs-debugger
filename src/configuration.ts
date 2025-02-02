import { UsbInterfaceMatch } from '@my/services/usb'

export enum ServerType {
  Qemu = 'qemu',
  Bmp = 'bmp',
}

export interface QemuServerConfiguration {
  type: 'qemu'
  machine?: string
  cpu?: string
}

export interface BmpServerConfiguration {
  type: 'bmp'
  port?: string
  serial?: string
  swoPort: UsbInterfaceMatch
}

export type ServerConfiguration = QemuServerConfiguration | BmpServerConfiguration

export enum SmuType {
  StLink = 'stlink',
}

export interface StlinkSmuConfiguration {
  type: 'stlink'
  port?: string
  serial?: string
  output?: 'vout' | 'vaux'
  voltage?: number
  startPowerOn?: boolean
  stopPowerOff?: boolean
}

export type SmuConfiguration = StlinkSmuConfiguration

export interface LaunchConfiguration {
  server: ServerType | ServerConfiguration
  smu?: SmuType | SmuConfiguration
  cwd?: string
  env?: Record<string, string>
  program: string
}
