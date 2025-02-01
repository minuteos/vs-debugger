import { getLog, getTrace } from '@my/services'
import * as vscode from 'vscode'

const log = getLog('Settings')
const trace = getTrace('Settings')

export interface Settings {
  trace: string[]
  defaults: {
    server: Record<string, Record<string, unknown>>
    smu: Record<string, Record<string, unknown>>
  }
}

const defaults: Settings = Object.freeze({
  trace: [],
  defaults: {
    server: {},
    smu: {},
  },
})

export let settings = defaults

vsLoadSettings()

type VsSettings = Settings

function vsLoadSettings(): Settings {
  function loadConfig() {
    // eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars
    const { has, get, update, inspect, ...vsCfg } = vscode.workspace.getConfiguration('minuteDebug')
    const vs: VsSettings = vsCfg as VsSettings
    const patches = {}
    settings = Object.freeze({ ...defaults, ...vs, ...patches })
    trace(settings)
  }

  vscode.workspace.onDidChangeConfiguration(() => {
    log.debug('Settings changed')
    loadConfig()
  })
  loadConfig()

  return settings
}
