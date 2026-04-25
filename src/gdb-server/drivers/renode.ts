import { RenodeServerConfiguration } from '@my/configuration'
import { ChildProcess, getLog } from '@my/services'
import { allocateTcpPort, findExecutable, pick, throwError } from '@my/util'

import { GdbServer, GdbServerOptions, TargetInfo } from '../gdb-server'
import { RenodeMonitor } from './renode-monitor'

const log = getLog('Renode')

const LOCALHOST = '127.0.0.1'

// Cold-start Mono on Windows can be slow; allow generous startup time.
const MONITOR_CONNECT_TIMEOUT_MS = 30000

// Long enough to let renode acknowledge but short enough not to stall a
// session teardown if it's stuck.
const QUIT_TIMEOUT_MS = 2000

// Standard Renode error prefix; specific enough to avoid false positives.
const RENODE_ERROR = /^There was an error/m

interface RenodeGdbServerOptions extends GdbServerOptions {
  serverConfig: RenodeServerConfiguration
}

export class RenodeGdbServer extends GdbServer<RenodeGdbServerOptions> {
  readonly identity = undefined
  readonly skipLoad = true

  address!: string
  private monitor?: RenodeMonitor

  async start(): Promise<void> {
    const { launchConfig, serverConfig } = this.options

    const monitorPort = await allocateTcpPort()
    const gdbPort = await allocateTcpPort()
    this.address = `${LOCALHOST}:${gdbPort.toString()}`

    const executable = serverConfig.executable ?? await findExecutable('renode')
    // --disable-gui: headless (also implies HideMonitor)
    // -p: plain output (no ANSI steering codes on the control port)
    // -P: listen for Monitor commands on the given TCP port
    const args = [
      '--disable-gui',
      '-p',
      '-P', monitorPort.toString(),
      ...serverConfig.extraArgs ?? [],
    ]

    log.info('Starting', executable)
    const child = this.use(
      new ChildProcess(executable, args, pick(launchConfig, 'cwd', 'env')),
    )
    child.forwardLines(child.stdout, (line) => {
      log.info(line)
    })
    child.forwardLines(child.stderr, (line) => {
      log.error(line)
    })

    // SIGTERM fallback if graceful quit didn't bring Renode down.
    this.defer(() => {
      if (child.exitCode === null) {
        log.debug('Sending SIGTERM to Renode')
        child.process.kill('SIGTERM')
      }
    })

    const monitor = this.use(new RenodeMonitor({
      host: LOCALHOST,
      port: monitorPort,
      connectTimeoutMs: MONITOR_CONNECT_TIMEOUT_MS,
    }))
    this.monitor = monitor

    // Disposal is LIFO, so this runs before the monitor socket close and
    // before the SIGTERM, giving Renode a chance to shut down cleanly.
    this.defer(async () => {
      log.debug('Asking Renode to quit')
      await monitor.quit(QUIT_TIMEOUT_MS)
    })

    await monitor.connect()

    if (serverConfig.script) {
      log.info('Loading script', serverConfig.script)
      await this.runMonitor(`include @${serverConfig.script}`)
    }

    for (const cmd of serverConfig.commands ?? []) {
      await this.runMonitor(cmd)
    }

    if (serverConfig.machine) {
      await this.runMonitor(`mach set "${serverConfig.machine}"`)
    }

    log.info('Starting Renode GDB server on port', gdbPort)
    await this.runMonitor(`machine StartGdbServer ${gdbPort.toString()}`)
  }

  attach(): Promise<TargetInfo> {
    // After StartGdbServer the monitor's current context is the machine name,
    // which is the closest thing to a "model" identifier Renode exposes.
    return Promise.resolve({ model: this.monitor?.currentContext })
  }

  /**
   * Sends a command via the monitor and surfaces Renode's standard error
   * format as a thrown exception. Plain output (including command echoes
   * and benign warnings) is logged at debug level.
   */
  private async runMonitor(command: string): Promise<string> {
    const monitor = this.monitor ?? throwError(new Error('Renode monitor not initialized'))
    const result = await monitor.execute(command)
    if (result) {
      log.debug(command, '→', result)
    }
    if (RENODE_ERROR.test(result)) {
      throw new Error(`Renode command failed: ${command}\n${result}`)
    }
    return result
  }
}
