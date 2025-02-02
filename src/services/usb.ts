import { getLog, getTrace } from '@my/services'
import { DeviceMatch } from '@my/services/match.common'
import { Matcher, MatchValueOrFunction } from '@my/util'
import { Readable } from 'stream'
import { ConfigDescriptor, Endpoint, EndpointDescriptor, InEndpoint, Interface, InterfaceDescriptor, OutEndpoint, usb } from 'usb'
import { promisify } from 'util'

const log = getLog('USB')
const trace = getTrace('USB')

export interface UsbInterfaceMatch extends DeviceMatch {
  configuration?: MatchValueOrFunction<string>
  interface?: MatchValueOrFunction<string>
  endpoints?: MatchValueOrFunction<EndpointCriteria>
}

export enum TransferType {
  Control, Isochronous, Bulk, Interrupt,
}

export enum EndpointDirection {
  In = 0x80,
  Out = 0,
}

export interface EndpointCriteria {
  address?: MatchValueOrFunction<number>
  type?: MatchValueOrFunction<TransferType>
  direction?: MatchValueOrFunction<EndpointDirection>
}

export class MatchedUsbInterface {
  private claimed?: Interface

  constructor(readonly device: usb.Device,
    readonly cfg: ConfigDescriptor,
    readonly iface: InterfaceDescriptor,
    readonly ep: EndpointDescriptor[],
    readonly name = '<unknown name>',
    readonly ifname = '<unnamed interface>',
  ) {}

  get configuration() { return this.cfg.bConfigurationValue }
  get interfaceNumber() { return this.iface.bInterfaceNumber }
  get alternateSetting() { return this.iface.bAlternateSetting }
  get endpoints() {
    return this.ep.map(ep => ({
      address: ep.bEndpointAddress & 0x7F,
      direction: (ep.bEndpointAddress & 0x80) as EndpointDirection,
    }))
  }

  toJSON() {
    return {
      name: this.name,
      cfg: this.configuration,
      iface: this.interfaceNumber,
      alt: this.alternateSetting,
      ep: this.endpoints,
    }
  }

  toString() {
    return `USB Dev: ${JSON.stringify(this.toJSON())}`
  }

  async claim(): Promise<AsyncDisposable> {
    const ds = new AsyncDisposableStack()

    try {
      log.debug('Claiming', this.toJSON())
      this.device.open()
      ds.defer(() => {
        this.device.close()
      })

      const iface = this.device.interface(this.interfaceNumber)
      iface.claim()
      ds.defer(() => iface.releaseAsync())
      await iface.setAltSettingAsync(this.alternateSetting)
      log.debug('Claimed', this.toJSON())
      this.claimed = iface
      ds.defer(() => {
        this.claimed = undefined
      })
      return ds
    } catch (error) {
      log.info('Failed to claim', this.toJSON(), error)
      await ds.disposeAsync()
      throw error
    }
  }

  endpoint(dir: EndpointDirection, index = 0): Endpoint {
    if (!this.claimed) {
      throw new Error('Interface not claimed')
    }

    const ep = this.endpoints.filter(d => d.direction === dir).at(index)
    if (ep) {
      const epObj = this.claimed.endpoint(ep.address | ep.direction)
      if (epObj) {
        return epObj
      }
    }
    throw new Error(`${EndpointDirection[dir]} endpoint ${index.toString()} not available`)
  }

  in(index = 0): InEndpoint { return this.endpoint(EndpointDirection.In, index) as InEndpoint }
  out(index = 0): OutEndpoint { return this.endpoint(EndpointDirection.Out, index) as OutEndpoint }

  inToStream(stream: Readable, index = 0): AsyncDisposable {
    const ep = this.in(index)
    const logName = `IN ${(ep.address & 0x7F).toString()}`
    const q: unknown[] = []

    stream._read = () => {
      while (q.length) {
        if (q[0] instanceof Error) {
          throw q[0]
        }
        if (!stream.push(q[0])) {
          return
        }
        q.unshift()
      }
    }

    ep.on('data', (buf: Buffer) => {
      if (q.length || !stream.push(buf)) {
        q.push(buf)
      }
    })

    ep.on('error', (err: Error) => {
      log.error(logName, err)
      if (!q.length) {
        stream.destroy(err)
      }
      q.push(err)
    })

    ep.on('end', () => {
      log.debug(logName, 'END')
      if (q.length || !stream.push(null)) {
        q.push(null)
      }
    })

    ep.startPoll()
    log.debug(logName, 'Polling started')

    const res = new AsyncDisposableStack()
    const stop = promisify(ep.stopPoll.bind(ep))
    res.defer(async () => {
      log.debug(logName, 'Stopping...')
      await stop()
      log.debug(logName, 'Stopped...')
    })
    return res
  }
}

export async function findUsbInterface(match: UsbInterfaceMatch): Promise<MatchedUsbInterface | undefined> {
  log.debug('Looking for interface matching', match)

  const devs = usb.getDeviceList()
  const matcher = new Matcher(trace)

  for (const dev of devs) {
    const dd = dev.deviceDescriptor

    if (await matcher.try('Device ID', match.deviceId, { vid: dd.idVendor, pid: dd.idProduct })) {
      dev.open()

      try {
        const _getStringDescriptor = promisify(dev.getStringDescriptor.bind(dev))
        const getStringDescriptor = (n: number) => n ? _getStringDescriptor(n) : Promise.resolve('')

        if (await matcher.try('Manufacturer', match.manufacturer, () => getStringDescriptor(dd.iManufacturer))
          && await matcher.try('Product Name', match.product, () => getStringDescriptor(dd.iProduct))
          && await matcher.try('Serial', match.serial, () => getStringDescriptor(dd.iSerialNumber))) {
          for (const cfg of dev.allConfigDescriptors) {
            if (await matcher.try('. Configuration', match.configuration, () => getStringDescriptor(cfg.iConfiguration))) {
              for (const iface of cfg.interfaces) {
                for (const alt of iface) {
                  if (await matcher.try('.. Interface', match.interface, () => getStringDescriptor(alt.iInterface))) {
                    const matchedEndpoints: EndpointDescriptor[] = []

                    for (const ep of alt.endpoints) {
                      if (await matcher.try('... Endpoint', match.endpoints, {
                        address: ep.bEndpointAddress & 0x7F,
                        type: (ep.bmAttributes & 3) as TransferType,
                        direction: (ep.bEndpointAddress & 0x80) as EndpointDirection,
                      })) {
                        matchedEndpoints.push(ep)
                      }
                    }

                    if (matchedEndpoints.length) {
                      return new MatchedUsbInterface(dev, cfg, alt, matchedEndpoints,
                        await getStringDescriptor(dd.iProduct), await getStringDescriptor(alt.iInterface))
                    }
                  }
                }
              }
            }
          }
        }
      } finally {
        dev.close()
      }
    }
  }

  log.debug('Could not find an interface matching', match)
  return undefined
}
