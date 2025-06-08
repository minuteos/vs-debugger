import { DebugTarget, DebugTargetRegisterInfo, DebugTargetRegisterTypeField } from '@my/interfaces'
import { groupBy } from '@my/util'
import { Builder } from 'xml2js'

export function generateFeaturesXml(target: DebugTarget): Buffer {
  const { architecture } = target.info
  const regs = target.registers.info
    .map((r, i) => [i, r])
    .filter(([,r]) => r) as [number, DebugTargetRegisterInfo][]
  const features = groupBy(regs, ([,r]) => r.gdbFeature)
  const types = target.registers.types ?? []

  const targetXml = {
    $: { version: '1.0' },
    architecture,
    osabi: 'none',
    feature: Object.entries(features).map(([name, reg]) => ({
      $: { name },
      ...types
        .reduce<Record<string, unknown[] | undefined>>((res, t) => {
          (res[t.type] ??= []).push({
            $: { id: t.id, size: t.size },
            field: t.fields.map(mapField),
          })
          return res
        }, {}),
      reg: reg.map(([regnum, r]) => ({ $: {
        name: r.name,
        bitsize: r.bits,
        regnum,
        type: r.type ?? 'int',
        group: r.group,
      } })),
    })),
  }

  const builder = new Builder({
    rootName: 'target',
    doctype: { sysID: 'gdb-target.dtd' },
  })
  const xml = builder.buildObject(targetXml)
  return Buffer.from(xml)
}

function mapField(f: DebugTargetRegisterTypeField) {
  const { name, bit } = f
  const start = Array.isArray(bit) ? bit[0] : bit
  const end = Array.isArray(bit) ? bit[1] : bit
  const defaultType = typeof bit === 'number' ? 'bool' : 'uint'
  const { type = defaultType } = f
  return {
    $: { name, type, start, end },
  }
}
