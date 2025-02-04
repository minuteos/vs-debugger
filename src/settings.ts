import { InputLaunchConfiguration, ServerConfiguration, SmuConfiguration } from '@my/configuration'
import { defaults } from '@my/defaults'
import { getLog, getTrace } from '@my/services'
import { mergeDefaults } from '@my/util'
import * as vscode from 'vscode'

const log = getLog('Settings')
const trace = getTrace('Settings')

export interface Settings {
  trace: string[]
  server: Record<string, ServerConfiguration>
  smu: Record<string, SmuConfiguration>
  defaults: {
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
