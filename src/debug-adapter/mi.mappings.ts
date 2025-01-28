import { FrameInfo, ThreadInfo } from '@my/gdb/mi.commands'
import { DebugProtocol } from '@vscode/debugprotocol'

export const mapThreadInfo = (ti: ThreadInfo): DebugProtocol.Thread => ({
  id: ti.id, name: ti.frame.func,
})

export const mapStackFrame = (frame: FrameInfo): DebugProtocol.StackFrame => ({
  id: frame.level,
  name: frame.func,
  line: frame.line ?? 0,
  column: frame.column ?? 0,
  source: {
    name: frame.file,
    path: frame.fullname,
  },
})
