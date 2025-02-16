import { configureVsCodeStorage } from '@my/services/storage'
import 'disposablestack/auto'
import * as vscode from 'vscode'

import { MinuteDebugAdapterDescriptorFactory } from './debug-adapter/descriptor-factory'

export let context: vscode.ExtensionContext

export function activate(context: vscode.ExtensionContext) {
  console.log('Activating minuteDebug...')

  configureVsCodeStorage(context)

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('minute-debug', new MinuteDebugAdapterDescriptorFactory()),
  )
}

export function deactivate() {
  console.log('Deactivating minuteDebug...')
}
