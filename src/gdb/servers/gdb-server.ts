import { LaunchConfiguration } from '@my/configuration'
import { MiCommands } from '@my/gdb/mi.commands'
import { ChildProcess, getLog } from '@my/services'
import { DisposableContainer, pick } from '@my/util'
import { Readable } from 'stream'

const log = getLog('GDBServer')

export interface GdbServerOptions {
  launchConfig: LaunchConfiguration
}

export abstract class GdbServer<TOptions extends GdbServerOptions = GdbServerOptions> extends DisposableContainer {
  constructor(protected readonly options: TOptions) {
    super()
  }

  abstract start(): Promise<void>
  abstract attach(mi: MiCommands): Promise<void>

  abstract readonly address: string
  declare readonly swoStream?: Readable
}

export abstract class ExecutableGdbServer<T extends GdbServerOptions> extends GdbServer<T> {
  private server?: ChildProcess

  abstract getExecutable(): Promise<string> | string
  abstract getArguments(): Promise<string[]> | string[]

  async start(): Promise<void> {
    const executable = await this.getExecutable()
    const args = await this.getArguments()
    log.info('Starting', executable)
    this.defer(() => {
      if (this.server) {
        log.info('Finished with exit code', this.server.exitCode)
      }
    })
    const server = this.use(
      new ChildProcess(executable, args,
        pick(this.options.launchConfig, 'cwd', 'env')),
    )
    this.server = server
    server.forwardLines(server.stdout, (line) => {
      log.info(line)
    })
    server.forwardLines(server.stderr, (line) => {
      log.error(line)
    })

    log.info('Started', executable)
    this.defer(() => {
      log.info('Tearing down GDB server')
      server.process.kill('SIGTERM')
    })
  }
}
