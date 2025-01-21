import * as vscode from 'vscode'

import { MinuteDebugSession } from './session'

export class MinuteDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(
      new MinuteDebugSession(),
    )
  }
}
