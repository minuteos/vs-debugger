import { getLog, getTrace } from '@my/services'
import { Matcher, MatchValueOrFunction, pick, ValueProvider } from '@my/util'
import { platform } from 'os'
import { SerialPort } from 'serialport'

import { DeviceMatch } from './match.common'

const log = getLog('Serial')
const trace = getTrace('Serial')

export interface PortMatch extends DeviceMatch {
  index?: MatchValueOrFunction<number>
}

export async function findSerialPort(match: PortMatch): Promise<string | undefined> {
  match = pick(match, 'deviceId', 'manufacturer', 'product', 'serial', 'index')
  log.debug('Looking for port matching', match)

  const ports = await SerialPort.list()
  const matcher = new Matcher(trace)

  async function filter<T>(name: keyof PortMatch, criterion: MatchValueOrFunction<T> | undefined, value: (p: typeof ports[0]) => ValueProvider<T> | undefined) {
    for (let i = 0; i < ports.length; i++) {
      if (!await matcher.try(name, criterion, value(ports[i]))) {
        ports.splice(i--, 1)
      }
    }
  }

  // filter ports down
  await filter('deviceId', match.deviceId, p => ({
    vid: parseInt(p.vendorId ?? '', 16),
    pid: parseInt(p.productId ?? '', 16),
  }))

  await filter('manufacturer', match.manufacturer, p => p.manufacturer)
  await filter('product', match.product, p => p.pnpId) // match product against PNP ID
  await filter('serial', match.serial, p => p.serialNumber)

  // sort by pnpID/path to get a stable order
  ports.sort((a, b) => (a.pnpId ?? a.path).localeCompare(b.pnpId ?? b.path))

  for (let i = 0; i < ports.length; i++) {
    if (await matcher.try('index', match.index, i)) {
      // got a match
      let { path } = ports[i]
      if (platform() === 'darwin') {
        // tty devs on macOS are blocked after opening, we want to use the cu (calling unit) variant
        path = path.replace('/dev/tty.', '/dev/cu.')
      }
      log.debug('Matched port', path)
      return path
    }
  }

  return undefined
}
