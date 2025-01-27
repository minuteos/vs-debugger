import { BmpServerConfiguration } from '@my/configuration'

import { GdbServer } from './gdb-server'

export class BmpGdbServer extends GdbServer {
  get address(): string {
    throw new Error('Method not implemented.')
  }

  constructor(readonly config: BmpServerConfiguration) {
    super()
  }

  start(): Promise<void> {
    throw new Error('Method not implemented.')
  }
}
