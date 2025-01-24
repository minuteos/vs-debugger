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
 * Reads data from the specified binary stream and splits them into individual lines.
 * @param stream A readable stream to read data from
 * @param opts Extra options
 */
export async function* readLines(stream: Readable, opts: ReadLinesOptions = {}): AsyncIterable<Buffer> {
  const maxLine = opts.maximumLineLength ?? 65536
  const eol = opts.eolByte ?? LF

  const previousBlocks: Buffer[] = []
  let lineLength = 0 // total length of line, -1 when discarding

  function outputLine(final: Buffer): Buffer {
    if (lineLength > maxLine) {
      lineLength = maxLine
    }

    const res = previousBlocks.length
      ? Buffer.concat([...previousBlocks, final], lineLength)
      : final.subarray(0, lineLength)

    // reset line data
    previousBlocks.length = 0
    lineLength = 0
    return res
  }

  let block!: Buffer
  for await (block of stream) {
    if (!Buffer.isBuffer(block)) {
      throw new Error('Only Buffer stream is supported')
    }
    // look for line ends in the new chunk
    let end: number
    while ((end = block.indexOf(eol)) >= 0) {
      if (lineLength >= 0) {
        lineLength += end
        yield outputLine(block)
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
        yield outputLine(block)
        lineLength = -1
      } else {
        previousBlocks.push(block)
      }
    }
  }

  if (lineLength > 0) {
    // last line without EOL
    if (lineLength > maxLine) {
      lineLength = maxLine
    }
    yield Buffer.concat(previousBlocks, lineLength)
  }
}
