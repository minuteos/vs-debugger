import { SwvFormat } from '@my/gdb/cortex'
import { EndpointDirection, TransferType } from '@my/services/usb'
import { Settings } from '@my/settings'

const BMP_VID = 0x1d50
const BMP_PID = 0x6018

const ST_VID = 0x0483
const STLINK_V3PWR_PID = 0x3757

export const defaults: Settings = Object.freeze<Settings>({
  trace: [],
  server: {
    bmp: {
      type: 'bmp',
      deviceId: { vid: BMP_VID, pid: BMP_PID },
    },
    qemu: {
      type: 'qemu',
    },
  },
  smu: {
    stlink: {
      type: 'stlink',
      deviceId: [
        { vid: ST_VID, pid: STLINK_V3PWR_PID },
      ],
      index: 1,
      output: 'vout',
      voltage: 3.3,
      startPowerOn: false,
      stopPowerOff: false,
    },
  },
  swo: {
    bmp: {
      type: 'bmp',
      cpuFrequency: 0,
      swvFrequency: 100000,
      format: SwvFormat.Manchester,
      port: {
        interface: '*Trace Capture',
        endpoints: { type: TransferType.Bulk, direction: EndpointDirection.In },
      },
    },
  },
  defaults: {
    launch: {},
  },
})
