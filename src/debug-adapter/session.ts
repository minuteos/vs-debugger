import { LaunchConfiguration } from '@my/configuration'
import { ErrorCode } from '@my/errors'
import { GdbInstance } from '@my/gdb/instance'
import { MiCommands, MiExecStatus } from '@my/gdb/mi.commands'
import { createGdbServer } from '@my/gdb/servers/factory'
import { getLog, getTrace, traceEnabled } from '@my/services'
import { findExecutable } from '@my/util'
import { ContinuedEvent, DebugSession, ErrorDestination, Response, StoppedEvent } from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'

import * as mi from './mi.mappings'

type DebugHandler = (response: DebugProtocol.Response, args: unknown, request: DebugProtocol.Request) => Promise<string | boolean>
type DebugHandlers = Record<string, DebugHandler>

const log = getLog('DebugSession')
const trace = getTrace('DAP')

export class MinuteDebugSession extends DebugSession {
  private gdb?: GdbInstance

  get command(): MiCommands {
    const gdb = this.gdb
    if (!gdb) {
      throw new Error('GDB lost')
    }
    return gdb.command
  }

  // #region Command handlers
  /* eslint-disable @typescript-eslint/no-unused-vars */

  command_initialize(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
    response.body = {
    }
  }

  async command_launch(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments) {
    const config = args as LaunchConfiguration
    const gdb = new GdbInstance(config.program, (exec) => {
      this.execStatusChange(exec)
    })
    const server = createGdbServer(config)
    await Promise.all([
      gdb.start(await findExecutable('arm-none-eabi-gdb')),
      server.start(),
    ])
    this.gdb = gdb

    await gdb.command.targetSelect('extended-remote', server.address)
  }

  async command_disconnect(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
    const gdb = this.gdb
    this.gdb = undefined
    await gdb?.disposeAsync()
  }

  async command_threads(response: DebugProtocol.ThreadsResponse) {
    const res = await this.command.threadInfo()
    response.body = {
      threads: res.threads.map(mi.mapThreadInfo),
    }
  }

  async command_stackTrace(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
    const low = args.startFrame ?? 0
    const high = low + (args.levels ?? 1000) - 1
    const res = await this.command.stackListFrames(low, high)
    response.body = {
      stackFrames: res.stack.map(mi.mapStackFrame),
    }
  }

  /* eslint-enable @typescript-eslint/no-unused-vars */
  // #endregion

  // #region Execution status changes

  private execStatusChange(evt: MiExecStatus) {
    switch (evt.$class) {
      case 'running':
        if (evt.threadId === 'all') {
          this.sendEvent(new ContinuedEvent(0, true))
        } else {
          this.sendEvent(new ContinuedEvent(evt.threadId))
        }
        break
      case 'stopped':
        this.sendEvent(new StoppedEvent(evt.reason, evt.threadId))
        break
    }
  }
  // #endregion

  // #region Shared request handling

  protected dispatchRequest(request: DebugProtocol.Request): void {
    trace('<=', request.seq, request.command, request.arguments)

    const handler = async () => {
      const response = await this.handleRequest(request)
      if (response) {
        this.sendResponse(response)
      } else {
        // use the default handler
        super.dispatchRequest(request)
      }
    }

    handler().catch((error: unknown) => {
      log.error('Error handling command', request.command, error)

      const resp = new Response(request)
      let code = ErrorCode.Unknown
      let format = 'Unknown error handling {command} request: {error}'
      const defaultVars = { command: request.command, error }
      let variables: object = defaultVars
      let destination = ErrorDestination.User | ErrorDestination.Telemetry
      if (error instanceof Object) {
        if ('code' in error && typeof error.code === 'number') {
          code = error.code
        }
        if ('message' in error) {
          defaultVars.error = error.message
        }
        if ('format' in error && typeof error.format === 'string') {
          format = error.format
        }
        if ('variables' in error && error.variables !== null && typeof error.variables === 'object') {
          variables = error.variables
        }
        if ('destination' in error && typeof error.destination === 'number') {
          destination = error.destination
        }
      }
      super.sendErrorResponse(resp, code, format, variables, destination)
    })
  }

  sendResponse(response: DebugProtocol.Response): void {
    trace('>=', response.request_seq, response.command, response.seq, response.success, response.body)
    super.sendResponse(response)
  }

  sendEvent(event: DebugProtocol.Event): void {
    trace('~>', event.seq, event.event, event.body)
    super.sendEvent(event)
  }

  sendRequest(command: string, args: unknown, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
    trace('=>', command, args, timeout)
    super.sendRequest(command, args, timeout, traceEnabled('dap')
      ? (response) => {
          trace('=<', command, response)
          cb(response)
        }
      : cb)
  }

  async handleRequest(request: DebugProtocol.Request): Promise<DebugProtocol.Response | undefined> {
    const handlerName = 'command_' + request.command
    const resp: Response & { message?: string } = new Response(request)
    const handler = (this as unknown as DebugHandlers)[handlerName]
    if (typeof handler !== 'function') {
      log.warn('no handler for request', request.command)
      return undefined
    } else {
      const message = await handler.apply(this, [resp, request.arguments, request])
      if (typeof message === 'string') {
        resp.message = message
      }
    }
    return resp
  }

  // #endregion
}
