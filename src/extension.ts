import * as vscode from 'vscode'

import { MinuteDebugAdapterDescriptorFactory } from './debug-adapter/descriptor-factory'

export function activate(context: vscode.ExtensionContext) {
  console.log('Activating minuteDebug...')

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('minute-debug', new MinuteDebugAdapterDescriptorFactory()),
  )
}

export function deactivate() {
  console.log('Deactivating minuteDebug...')
}
