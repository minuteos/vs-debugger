import { MatchValueOrFunction } from '@my/util'

export interface DeviceMatch {
  deviceId?: MatchValueOrFunction<{ vid: number, pid: number }>
  manufacturer?: MatchValueOrFunction<string>
  product?: MatchValueOrFunction<string>
  serial?: MatchValueOrFunction<string>
}
