import { FrameInfo, ThreadInfo } from '@my/gdb/mi.commands'
import { DebugProtocol } from '@vscode/debugprotocol'

import { Instruction } from './disassembly'

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
  instructionPointerReference: frame.addr,
})

export const formatAddress = (addr: number): string => {
  // -1 is treated as a special marker of invalid address by VS Code
  return addr < 0 ? '-1' : '0x' + addr.toString(16)
}

export const mapInstruction = (ins: Instruction): DebugProtocol.DisassembledInstruction => ({
  address: formatAddress(ins.s),
  instruction: ins.fn && !ins.offset
    ? `${ins.mnemonic}\t;;; FUNCTION: ${ins.fn}`
    : ins.mnemonic,
  instructionBytes: ins.bytes,
  location: ins.src
    ? {
        name: ins.src.file,
        path: ins.src.fullname,
      }
    : undefined,
  line: ins.src?.line,
  endLine: ins.src?.endLine,
  symbol: ins.fn,
})
