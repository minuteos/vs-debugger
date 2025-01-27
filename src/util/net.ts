import { getLog } from '@my/services'
import { promiseWithResolvers } from '@my/util/promise'
import { AddressInfo, createServer } from 'net'

const localhost = '127.0.0.1'

const log = getLog('Net')

export async function allocateTcpPort(): Promise<number> {
  const server = createServer()
  const { promise, resolve, reject } = promiseWithResolvers()
  server.once('listening', resolve)
  server.once('error', reject)
  server.listen(undefined, localhost)
  await promise
  const port = (server.address() as AddressInfo).port
  server.close()
  log.debug('Allocated TCP port', port)
  return port
}
