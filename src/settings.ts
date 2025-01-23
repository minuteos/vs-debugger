import { getLog } from '@my/services'
import * as vscode from 'vscode'

const log = getLog('Settings')

export interface Settings {
  trace: Record<string, boolean>
}

const defaults: Settings = {
  trace: {},
}

export const settings = vsLoadSettings()

interface VsSettings extends Omit<Settings, 'trace'> {
  trace: string[]
}

function vsLoadSettings(): Settings {
  const settings: Settings = { ...defaults }

  function loadConfig() {
    // eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-unused-vars
    const { has, get, update, inspect, ...vsCfg } = vscode.workspace.getConfiguration('minuteDebug')
    const vs: VsSettings = vsCfg as VsSettings
    const patches = {
      trace: Object.fromEntries(vs.trace.map(k => [k.toLowerCase(), true])),
    }
    Object.assign(settings, { ...defaults, ...vs, ...patches })
    // cannot use traceEnabled at this point, because the settings global may not be initialized
    if (settings.trace.settings) {
      log.trace('Current Settings', settings)
    }
  }

  vscode.workspace.onDidChangeConfiguration(() => {
    log.debug('Settings changed')
    loadConfig()
  })
  loadConfig()

  return settings
}
