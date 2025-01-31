import { ChildProcess, getLog } from '@my/services'

const log = getLog('GDBServer')

export abstract class GdbServer extends AsyncDisposableStack {
  abstract start(): Promise<void>

  abstract get address(): string
}

export abstract class ExecutableGdbServer extends GdbServer {
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
    const server = this.use(new ChildProcess(executable, args))
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
