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

  /** QEMU machine to emulate. */
  machine?: string

  /** QEMU CPU to emulate. */
  cpu?: string
}

export interface BmpServerConfiguration extends DeviceMatch {
  type: 'bmp'

  /** Serial port of the Black Magic Probe. Auto-detected when omitted. */
  port?: string

  /** Supply target power from the probe. */
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

  /** Serial port of the SMU. Auto-detected when omitted. */
  port?: string

  /** Output channel to drive (e.g. `vout` or `vaux`). */
  output: string

  /** Output voltage in volts. */
  voltage: number

  /** Turn the output on when the debug session starts. */
  startPowerOn: boolean

  /** Turn the output off when the debug session ends. */
  stopPowerOff: boolean
}

export type SmuConfiguration = StlinkSmuConfiguration

export enum SwoType {
  Bmp = 'bmp',
}

export interface CommonSwoConfiguration {
  /** Target CPU frequency in Hz. 0 keeps the probe default. */
  cpuFrequency: number

  /** SWO/SWV bitrate in Hz. */
  swvFrequency: number

  /** SWV encoding (1 = Manchester, 2 = UART). */
  format: SwvFormat
}

export interface BmpSwoConfiguration extends DeviceMatch, CommonSwoConfiguration {
  type: 'bmp'

  /** USB interface carrying the SWO stream. */
  port: UsbInterfaceMatch
}

export type SwoConfiguration = BmpSwoConfiguration

export interface SvdConfiguration {
  /** SVD model name. */
  model: string

  /** Restrict to matching peripherals. */
  peripherals?: string | string[]
}

export interface InputLaunchConfiguration {
  /** GDB server: a preset name from `minuteDebug.server`, or an inline server configuration. */
  server?: ServerType | (string & {}) | ServerConfiguration

  /** Source-measure unit: a preset name from `minuteDebug.smu`, or an inline configuration. */
  smu?: SmuType | (string & {}) | SmuConfiguration

  /** SWO/SWV trace: a preset name from `minuteDebug.swo`, or an inline configuration. */
  swo?: SwoType | (string & {}) | SwoConfiguration

  /** SVD: a model name, or a list of `{ model, peripherals }` layers. */
  svd?: string | SvdConfiguration[]

  /** Working directory for the debug session. */
  cwd?: string

  /** Environment variables. */
  env?: Record<string, string>

  /** Program (ELF) to debug. */
  program: string

  /** Only flash sections that differ from the device contents. */
  smartLoad?: boolean

  /** Keep the target halted after connecting instead of resuming execution. */
  stopAtConnect?: boolean
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

function lookup<T extends { type: string } | undefined>(table: Record<string, T>, cfg?: string | NoInfer<T>): T | undefined {
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
