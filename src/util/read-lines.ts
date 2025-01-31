import { Readable } from 'stream'

const LF = 10

/**
 * Options for the readLines helper
 */
interface ReadLinesOptions {
  /**
   * Maximum line length to be returned (in bytes), default 65536
   */
  maximumLineLength?: number

  /**
   * Byte used as line separator, default LF ('\n')
   */
  eolByte?: number
}

/**
 * Helper to convert series of binary buffers into individual lines
 */
export class LineReader {
  private readonly maxLine: number
  private readonly eol: number

  private readonly previousBlocks: Buffer[] = []
  private lineLength = 0 // total length of line, -1 when discarding

  constructor(opts: ReadLinesOptions = {}) {
    this.maxLine = opts.maximumLineLength ?? 65536
    this.eol = opts.eolByte ?? LF
  }

  process(block?: Buffer): Buffer[] {
    let { lineLength } = this
    const { maxLine, eol, previousBlocks } = this
    const lines = []

    function outputLine(final: Buffer) {
      if (lineLength > maxLine) {
        lineLength = maxLine
      }

      const res = previousBlocks.length
        ? Buffer.concat([...previousBlocks, final], lineLength)
        : final.subarray(0, lineLength)
      lines.push(res)

      // reset line data
      previousBlocks.length = 0
      lineLength = 0
    }

    if (block) {
      // look for lines in the new chunk
      let end: number
      while ((end = block.indexOf(eol)) >= 0) {
        if (lineLength >= 0) {
          lineLength += end
          outputLine(block)
        } else {
        // end of discard
          lineLength = 0
        }
        block = block.subarray(end + 1)
      }

      if (block.length && lineLength >= 0) {
        lineLength += block.length

        if (lineLength >= maxLine) {
        // return partial line, we'll discard the rest until the next EOL
          outputLine(block)
          lineLength = -1
        } else {
          previousBlocks.push(block)
        }
      }
    } else {
      // flush the rest of input
      if (lineLength > 0) {
        // last line without EOL
        if (lineLength > maxLine) {
          lineLength = maxLine
        }
        lines.push(Buffer.concat(previousBlocks, lineLength))
        previousBlocks.length = 0
        lineLength = 0
      }
    }

    this.lineLength = lineLength
    return lines
  }

  processAny(block: unknown): Buffer[] {
    if (!Buffer.isBuffer(block)) {
      throw new Error('Only Buffer stream is supported')
    }

    return this.process(block)
  }

  async *processStream(stream: Readable): AsyncIterable<Buffer> {
    for await (const block of stream) {
      for (const line of this.processAny(block)) {
        yield line
      }
    }

    for (const line of this.process()) {
      yield line
    }
  }
}

/**
 * Reads data from the specified binary stream and splits them into individual lines.
 * @param stream A readable stream to read data from
 * @param opts Extra options
 */
export function readLines(stream: Readable, opts: ReadLinesOptions = {}): AsyncIterable<Buffer> {
  return new LineReader(opts).processStream(stream)
}
