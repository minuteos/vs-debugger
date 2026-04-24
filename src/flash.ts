import { expandConfiguration, ServerConfiguration, SmuConfiguration } from '@my/configuration'
import { DebugError, ErrorCode } from '@my/errors'
import { Probe } from '@my/probe'
import { getLog, progress } from '@my/services'

const log = getLog('Flash')

export interface FlashOptions {
  server: string | ServerConfiguration
  smu?: string | SmuConfiguration
  program: string
  smartLoad?: boolean
  cwd?: string
  env?: Record<string, string>
}

export interface FlashResult {
  loaded: boolean
}

/**
 * Programs firmware into the target using the same GDB/server/SMU machinery as
 * a debug session, without allocating a DAP session. The probe is torn down
 * before the promise resolves.
 */
export async function flash(options: FlashOptions): Promise<FlashResult> {
  const config = expandConfiguration(options)

  await using probe = new Probe(config)
  await probe.connect()

  if (probe.server.skipLoad) {
    throw new DebugError(
      'Server type {type} does not support programming',
      { type: config.server.type },
      undefined,
      ErrorCode.NotSupported,
    )
  }

  const loaded = await progress('Flashing program', async (p) => {
    return probe.load((message, fraction) => {
      p.report(message, fraction)
    })
  })

  if (loaded) {
    log.info('Program flashed')
  } else {
    log.info('Program already up to date (smart-load)')
  }

  return { loaded }
}

export interface MinuteDebugApi {
  flash(options: FlashOptions): Promise<FlashResult>
}
