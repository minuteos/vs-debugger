import { LaunchConfiguration } from '@my/configuration'

import { StlinkSmu } from './drivers/stlink'
import { Smu } from './smu'

const typeMap = {
  stlink: StlinkSmu,
}

export function createSmu(launchConfig: LaunchConfiguration): Smu | undefined {
  const { smu } = launchConfig
  if (!smu) {
    return undefined
  }

  if (!(smu.type in typeMap)) {
    throw new Error(`Unsupported SMU type: ${smu.type}`)
  }

  const type = typeMap[smu.type]
  return new type({ launchConfig, smuConfig: smu as never })
}
