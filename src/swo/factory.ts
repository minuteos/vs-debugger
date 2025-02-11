import { LaunchConfiguration } from '@my/configuration'

import { BmpSwo } from './drivers/bmp'
import { Swo } from './swo'

const typeMap = {
  bmp: BmpSwo,
}

export function createSwo(launchConfig: LaunchConfiguration): Swo | undefined {
  const { swo } = launchConfig
  if (!swo) {
    return undefined
  }

  if (!(swo.type in typeMap)) {
    throw new Error(`Unsupported SWO source: ${swo.type}`)
  }

  const type = typeMap[swo.type]
  return new type({ launchConfig, swoConfig: swo })
}
