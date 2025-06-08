import { DebugError } from '@my/errors'
import { DebugAccessPort, DebugTarget } from '@my/interfaces'
import { getLog } from '@my/services'
import { Cortex } from '@my/target/cortex'

const log = getLog('DAP-Probe')

type Source<T> = (re: RegExpExecArray) => T
type ValueOrSource<T> = T | Source<T>

interface Spec {
  device: ValueOrSource<string>
  revision: ValueOrSource<string>
}

const idcodeMap: [RegExp, Spec][] = [
  [/(....).415/, { device: 'STM32L47x', revision: re => re[1] }],
  [/(....).461/, { device: 'STM32L49x', revision: re => re[1] }],
]

const FP_CTRL = 0xE0002000

export async function probeTarget(dap: DebugAccessPort): Promise<DebugTarget> {
  const cpuid = (await dap.readCpuId()).readUInt32LE()

  // TODO: properly
  const idcode = (await dap.readMemory(0xe0042000, 4)).readUInt32LE().toString(16).padStart(8, '0')
  const uid = (await dap.readMemory(0x1fff7590, 12)).toString('hex')
  const fpCtrl = (await dap.readMemory(FP_CTRL, 4)).readUInt32LE()
  const fpbComparators = ((fpCtrl >> 4) & 0xF) | ((fpCtrl >> 8) & 0x30)
  let info

  for (const [re, spec] of idcodeMap) {
    const match = re.exec(idcode)
    if (match) {
      const extract = <T>(f: ValueOrSource<T>) => typeof f === 'function' ? (f as Source<T>)(match) : f

      info = {
        architecture: 'armv7e-m', // note: GDB doesn't seem to understand armv7-m (CM3)
        device: extract(spec.device),
        revision: extract(spec.revision),
        uid,
        fpbComparators,
      }
      break
    }
  }

  if (!info) {
    throw new DebugError('Unknown ID code: {idcode}', { idcode })
  }

  log.info(cpuid.toString(16), idcode, info)

  return new Cortex(dap, info)
}
