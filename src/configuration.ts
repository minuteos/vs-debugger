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
}

export type ServerConfiguration = QemuServerConfiguration | BmpServerConfiguration

export interface LaunchConfiguration {
  server: ServerType | ServerConfiguration
  program: string
}
