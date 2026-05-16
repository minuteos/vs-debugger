import { MatchValueOrFunction } from '@my/util'

export interface DeviceMatch {
  /** Match the USB device by vendor/product id. */
  deviceId?: MatchValueOrFunction<{ vid: number, pid: number }>

  /** Match the USB manufacturer string. */
  manufacturer?: MatchValueOrFunction<string>

  /** Match the USB product string. */
  product?: MatchValueOrFunction<string>

  /** Match the USB serial number. */
  serial?: MatchValueOrFunction<string>
}
