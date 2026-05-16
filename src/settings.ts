import { InputLaunchConfiguration, ServerConfiguration, SmuConfiguration, SwoConfiguration } from '@my/configuration'
import { defaults } from '@my/defaults'
import { getLog, getTrace } from '@my/services'
import { mergeDefaults } from '@my/util'
import * as vscode from 'vscode'

const log = getLog('Settings')
const trace = getTrace('Settings')

export interface Settings {
  /** Enable trace output for the listed components. */
  trace: string[]

  /** Named GDB server presets, referenced by name from a launch configuration's `server`. */
  server: Record<string, ServerConfiguration>

  /** Named source-measure unit presets, referenced by name from a launch configuration's `smu`. */
  smu: Record<string, SmuConfiguration>

  /** Named SWO/SWV trace presets, referenced by name from a launch configuration's `swo`. */
  swo: Record<string, SwoConfiguration>

  /** Defaults merged into every launch configuration. */
  defaults: {
    /** Fields applied to a launch/attach configuration when it does not specify them. */
    launch: Partial<InputLaunchConfiguration>
  }
}

export let settings = defaults

vsLoadSettings()

type VsSettings = Settings

function vsLoadSettings(): Settings {
  function loadConfig() {
    // eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars
    const { has, get, update, inspect, ...vsCfg } = vscode.workspace.getConfiguration('minuteDebug')
    const vs: VsSettings = vsCfg as VsSettings
    const patches = {}
    settings = Object.freeze(mergeDefaults({ ...vs, ...patches }, defaults))
    trace(settings)
  }

  vscode.workspace.onDidChangeConfiguration(() => {
    log.debug('Settings changed')
    loadConfig()
  })
  loadConfig()

  return settings
}
