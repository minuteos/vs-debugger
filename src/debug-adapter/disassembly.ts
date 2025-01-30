import { DebugError, ErrorCode } from '@my/errors'
import { DisassemblyInstruction, MiCommands } from '@my/gdb/mi.commands'
import { getLog } from '@my/services'
import { ErrorDestination } from '@vscode/debugadapter'

const log = getLog('Disassembly')

interface BaseRange {
  s: number
  e: number
}

interface UnknownRange extends BaseRange {
  promise?: Promise<void>
}

interface KnownRange extends BaseRange {
  instructions: Instruction[]
}

type Range = KnownRange | UnknownRange

function makeRange(instructions: Instruction[]): KnownRange {
  return { s: instructions[0].s, e: instructions[instructions.length - 1].e, instructions }
}

function errorRange(s: number, e: number, error: unknown): KnownRange {
  return { s, e, instructions: [
    { s, e, mnemonic: String(error) },
  ] }
}

function findRange<T extends BaseRange>(ranges: T[], address: number): [T, number] {
  let s = 0, e = ranges.length
  while (s <= e) {
    const m = (s + e) >> 1
    const r = ranges[m]
    if (address < r.s) {
      e = m - 1
    } else if (address >= r.e) {
      s = m + 1
    } else {
      return [r, m]
    }
  }

  throw new DebugError(`Couldn't find a range for {address}, cache corrupted`, { address }, ErrorDestination.Telemetry, ErrorCode.Internal)
}

export interface Source {
  file: string
  fullname: string
  line: number
  endLine?: number
}

export interface Instruction extends BaseRange {
  bytes?: string
  mnemonic: string
  src?: Source
  fn?: string
  offset?: number
}

export class DisassemblyCache {
  /**
   * A sorted array of non-overlapping contiguous ranges, covering the entire space of -infinity to infinity
   */
  private readonly ranges: Range[] = [
    errorRange(-Infinity, 0, 'Out of bounds'),
    { s: 0, e: Infinity },
  ]

  constructor(private readonly mi: MiCommands) {
  }

  private async resolveRange(address: number): Promise<KnownRange> {
    for (;;) {
      const [range] = findRange(this.ranges, address)
      if ('instructions' in range) {
        return range
      }
      if (range.promise) {
        await range.promise
        continue
      }

      // perform actual disassembly in the range
      await (range.promise = this.loadSection(range, address))
    }
  }

  /**
   * Loads a part of an unresolved range at the specified address.
   * Should never reject, as the promise is cached to avoid duplicate loads.
   */
  private async loadSection(range: UnknownRange, address: number): Promise<void> {
    try {
      log.debug('Requesting disassembly @', address.toString(16))
      const res = await this.mi.dataDisassemble({
        a: address,
        opcodes: 'bytes',
        source: true,
      })

      let src: Source | undefined = undefined
      const instructions: Instruction[] = []

      function add(ins: DisassemblyInstruction) {
        const s = parseInt(ins.address)
        const e = s + (ins.opcodes.length + 1) / 3

        const i = { s, e,
          mnemonic: ins.inst,
          bytes: ins.opcodes,
          src,
          fn: ins.funcName,
          offset: ins.offset,
        }

        if (s >= range.s && e <= range.e) {
          instructions.push(i)
        }
      }

      for (const grpOrIns of res.asm_insns) {
        if ('$type' in grpOrIns) {
          if (src) {
            src.endLine = grpOrIns.line
          } else {
            src = {
              file: grpOrIns.file,
              fullname: grpOrIns.fullname,
              line: grpOrIns.line,
            }
          }

          if (grpOrIns.line_asm_insn?.length) {
            for (const sub of grpOrIns.line_asm_insn) {
              add(sub)
            }
            src = undefined
          }
        } else {
          src = undefined
          add(grpOrIns)
        }
      }

      if (instructions.length) {
        // create a new range
        log.debug('Disassembled',
          instructions.length,
          'instructions between',
          instructions[0].s.toString(16),
          'and',
          instructions[instructions.length - 1].e.toString(16),
        )
        this.replaceRange(range, makeRange(instructions))
      } else {
        log.debug('Failed to disassemble any instructions at', address.toString(16))
      }
    } catch (err) {
      log.error('Error disassembling at', address.toString(16), err)
      this.replaceRange(range, errorRange(address, address + 1, err))
    }
  }

  private replaceRange(outer: UnknownRange, inner: KnownRange) {
    const [range, index] = findRange(this.ranges, outer.s)
    if (range !== outer) {
      log.warn('Range lost', outer)
      return
    }

    const newRanges: Range[] = [inner]
    if (inner.s > outer.s) {
      newRanges.unshift({ s: outer.s, e: inner.s })
    }
    if (inner.e < outer.e) {
      newRanges.push({ s: inner.e, e: outer.e })
    }
    this.ranges.splice(index, 1, ...newRanges)
  }

  async fill(address: number, offset: number, count: number): Promise<Instruction[]> {
    log.debug('Request for', count, 'instructions from', address.toString(16), 'offset', offset)
    let range = await this.resolveRange(address)
    let [, i] = findRange(range.instructions, address)
    i += offset // i is the instruction offset relative to the start of current range

    while (i < 0) {
      // need previous ranges
      range = await this.resolveRange(range.s - 1)
      if (!range.instructions.length) {
        // hit the boundary
        i = 0
        break
      }
      i += range.instructions.length
    }

    const res = []
    for (;;) {
      const { instructions } = range
      while (i < instructions.length) {
        res.push(instructions[i++])
        if (res.length >= count) {
          log.debug('Found', res.length, 'instructions between',
            res[0].s.toString(16), 'and', res[res.length - 1].e.toString(16))
          return res
        }
      }
      i -= instructions.length
      range = await this.resolveRange(range.e)
    }
  }
}
