import { flash, MinuteDebugApi } from '@my/flash'
import { configureVsCodeStorage } from '@my/services/storage'
import 'disposablestack/auto'
import * as vscode from 'vscode'

import { MinuteDebugAdapterDescriptorFactory } from './debug-adapter/descriptor-factory'

export let context: vscode.ExtensionContext

export function activate(context: vscode.ExtensionContext): MinuteDebugApi {
  console.log('Activating minuteDebug...')

  configureVsCodeStorage(context)

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('minute-debug', new MinuteDebugAdapterDescriptorFactory()),
  )

  return {
    flash,
  }
}

export function deactivate() {
  console.log('Deactivating minuteDebug...')
}

export type { FlashOptions, FlashResult, MinuteDebugApi } from '@my/flash'
