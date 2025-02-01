import { LaunchConfiguration } from '@my/configuration'
import { settings } from '@my/settings'

import { Smu } from './smu'
import { StlinkSmu } from './stlink'

const typeMap = {
  stlink: StlinkSmu,
}

export function createSmu(launchConfig: LaunchConfiguration): Smu | undefined {
  if (!launchConfig.smu) {
    return undefined
  }

  const smuType = typeof launchConfig.smu === 'object' ? launchConfig.smu.type : launchConfig.smu
  const defaultSettings = settings.defaults.smu[smuType]

  const smuConfig = {
    ...defaultSettings,
    ...(
      typeof launchConfig.smu === 'object'
        ? launchConfig.smu
        : { type: launchConfig.smu }),
  }

  if (!(smuType in typeMap)) {
    throw new Error(`Unsupported SMU type: ${smuType}`)
  }

  const type = typeMap[smuType]
  return new type(smuConfig as never, launchConfig)
}
