import { SwvFormat } from '@my/gdb/cortex'
import { DeviceMatch } from '@my/services/match.common'
import { PortMatch } from '@my/services/serial'
import { UsbInterfaceMatch } from '@my/services/usb'
import { settings } from '@my/settings'
import { mergeDefaults, throwError } from '@my/util'

export enum ServerType {
  Qemu = 'qemu',
  Bmp = 'bmp',
  Renode = 'renode',
}

export interface QemuServerConfiguration {
  type: 'qemu'
  machine?: string
  cpu?: string
}

export interface BmpServerConfiguration extends DeviceMatch {
  type: 'bmp'
  port?: string
  power?: boolean
}

export interface RenodeServerConfiguration {
  type: 'renode'

  /** Path to the renode executable; falls back to PATH lookup of "renode". */
  executable?: string

  /** .resc script to `include` after the monitor connects. */
  script?: string

  /** Monitor commands to run after the script (and before StartGdbServer). */
  commands?: string[]

  /** Selects the active machine in multi-machine setups via `mach set`. */
  machine?: string

  /** Extra command-line arguments appended after the defaults. */
  extraArgs?: string[]
}

export type ServerConfiguration = BmpServerConfiguration | QemuServerConfiguration | RenodeServerConfiguration

export enum SmuType {
  StLink = 'stlink',
}

export interface StlinkSmuConfiguration extends PortMatch {
  type: 'stlink'
  port?: string
  output: string /** vout or vaux */
  voltage: number
  startPowerOn: boolean
  stopPowerOff: boolean
}

export type SmuConfiguration = StlinkSmuConfiguration

export interface CommonSwoConfiguration {
  cpuFrequency: number
  swvFrequency: number
  format: SwvFormat
}

export interface BmpSwoConfiguration extends DeviceMatch, CommonSwoConfiguration {
  type: 'bmp'
  port: UsbInterfaceMatch
}

export type SwoConfiguration = BmpSwoConfiguration

export interface SvdConfiguration {
  model: string
  peripherals?: string | string[]
}

export interface InputLaunchConfiguration {
  server?: string | ServerConfiguration
  smu?: string | SmuConfiguration
  swo?: string | SwoConfiguration
  svd?: string | SvdConfiguration[]
  cwd?: string
  env?: Record<string, string>
  program: string
  smartLoad?: boolean
}

export interface LaunchConfiguration {
  server: ServerConfiguration
  smu?: SmuConfiguration
  swo?: SwoConfiguration
  svd?: SvdConfiguration[]
  cwd?: string
  env?: Record<string, string>
  program: string
  smartLoad?: boolean
  stopAtConnect?: boolean
}

function lookup<T extends { type: string } | undefined>(table: Record<string, T>, cfg?: string | T): T | undefined {
  if (cfg === undefined) {
    return undefined
  }

  if (typeof cfg === 'string') {
    return table[cfg]
  }

  const defaults = table[cfg.type]
  if (defaults) {
    cfg = mergeDefaults(cfg, defaults)
  }
  return cfg
}

export function expandConfiguration(config: InputLaunchConfiguration): LaunchConfiguration {
  const { server, smu, swo, svd, ...other } = mergeDefaults(config, settings.defaults.launch)
  return {
    ...other,
    server: lookup(settings.server, server)
      ?? throwError(new Error('server must be specified in launch configuration or in minute-debug.defaults.launch')),
    smu: lookup(settings.smu, smu),
    swo: lookup(settings.swo, swo),
    svd: typeof svd === 'string' ? [{ model: svd }] : svd,
  }
}
