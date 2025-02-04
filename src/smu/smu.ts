import { LaunchConfiguration, SmuConfiguration } from '@my/configuration'
import { Plugin } from '@my/plugin'

export interface SmuOptions {
  launchConfig: LaunchConfiguration
  smuConfig: SmuConfiguration
}

export abstract class Smu<TOptions extends SmuOptions = SmuOptions> extends Plugin<TOptions> {
  abstract connect(): Promise<void>
}
