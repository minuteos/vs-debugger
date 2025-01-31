import { LaunchConfiguration } from '@my/configuration'
import { DisassemblyCache } from '@my/debug-adapter/disassembly'
import { configureError, DebugError, ErrorCode, ErrorDestination, MiError } from '@my/errors'
import { GdbInstance } from '@my/gdb/instance'
import { BreakpointInfo, BreakpointInsertCommandResult, FrameInfo, MiCommands, MiExecStatus } from '@my/gdb/mi.commands'
import { createGdbServer } from '@my/gdb/servers/factory'
import { GdbServer } from '@my/gdb/servers/gdb-server'
import { getLog, getTrace, traceEnabled } from '@my/services'
import { findExecutable } from '@my/util'
import { ContinuedEvent, DebugSession, InitializedEvent, Response, Scope, StoppedEvent } from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'

import * as mi from './mi.mappings'
import { mapInstruction } from './mi.mappings'

type DebugHandler = (response: DebugProtocol.Response, args: unknown, request: DebugProtocol.Request) => Promise<string | boolean>
type DebugHandlers = Record<string, DebugHandler>

const log = getLog('DebugSession')
const trace = getTrace('DAP')

export class MinuteDebugSession extends DebugSession {
  private gdb?: GdbInstance
  private server?: GdbServer
  private disassemblyCache?: DisassemblyCache

  get command(): MiCommands {
    const gdb = this.gdb
    if (!gdb) {
      throw new Error('GDB not started')
    }
    if (!gdb.running) {
      throw new Error('GDB lost')
    }
    return gdb.command
  }

  async dispose() {
    await this.cleanup()
    super.dispose()
  }

  private async cleanup() {
    try {
      await this.server?.disposeAsync()
    } catch (err) {
      log.error('Failed to dispose GDB server', err)
    }
    try {
      await this.gdb?.disposeAsync()
    } catch (err) {
      log.error('Failed to dispose GDB', err)
    }
  }

  // #region Command handlers
  /* eslint-disable @typescript-eslint/no-unused-vars */

  command_initialize(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
    response.body = {
      supportsSteppingGranularity: true,
      supportsDisassembleRequest: true,
      supportsInstructionBreakpoints: true,
    }
  }

  async command_launch(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments) {
    const config = args as LaunchConfiguration
    this.gdb = new GdbInstance(config, (exec) => {
      this.execStatusChange(exec)
    })
    this.server = createGdbServer(config)
    await Promise.all([
      this.gdb.start(await findExecutable('arm-none-eabi-gdb')),
      this.server.start(),
    ])

    await this.command.gdbSet('mi-async', 1)
    await this.command.targetSelect('extended-remote', this.server.address)

    this.sendEvent(new InitializedEvent())
  }

  async command_disconnect(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
    await this.cleanup()
  }

  async command_threads(response: DebugProtocol.ThreadsResponse) {
    const res = await this.command.threadInfo()
    response.body = {
      threads: res.threads.map(mi.mapThreadInfo),
    }
  }

  frameIdMap = new Map<number, FrameInfo>()

  async command_stackTrace(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
    const low = args.startFrame ?? 0
    const high = low + (args.levels ?? 1000) - 1
    const res = await this.command.stackListFrames(low, high)

    // update most recent frame Id mappings
    res.stack.forEach(fi => this.frameIdMap.set(fi.level, fi))

    response.body = {
      stackFrames: res.stack.map(mi.mapStackFrame),
    }
  }

  private nextVar = 1

  async command_evaluate(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
    const addr = (args.frameId ? this.frameIdMap.get(args.frameId)?.addr : undefined) ?? '*'

    if (args.context === 'repl' && args.expression.startsWith('>')) {
      // execute console command
      try {
        const res = await this.command.interpreterExec('console', args.expression.substring(1))
        response.body = {
          result: (res.$console ?? ''),
          variablesReference: 0,
        }
      } catch (error) {
        throw configureError(error, ErrorCode.ConsoleEvaluationError, ErrorDestination.None)
      }
    } else if (args.context === 'repl' && (/^-[a-z]/.exec(args.expression)) && this.gdb) {
      // execute raw MI command
      try {
        const res = await this.gdb.mi.execute(args.expression.substring(1))
        response.body = {
          result: JSON.stringify(res),
          variablesReference: 0,
        }
      } catch (error) {
        throw configureError(error, ErrorCode.ConsoleEvaluationError, ErrorDestination.None)
      }
    } else {
      // evalaulte variable
      const num = this.nextVar++
      try {
        const res = await this.command.varCreate(`v${num.toString()}`, addr, args.expression)
        response.body = {
          result: String(res.value),
          variablesReference: res.numchild ? num : 0,
        }
      } catch (error) {
        throw configureError(error, ErrorCode.EvaluationError, ErrorDestination.None)
      }
    }
  }

  command_scopes(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
    response.body = {
      scopes: [
        new Scope('Local', 1, false),
        new Scope('Global', 2, true),
      ],
    }
  }

  async command_pause(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) {
    await this.command.execInterrupt()
  }

  async command_continue(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
    await this.command.execContinue()
  }

  async command_next(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
    if (args.granularity === 'instruction') {
      await this.command.execNextInstruction()
    } else {
      await this.command.execNext()
    }
  }

  async command_stepIn(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
    if (args.granularity === 'instruction') {
      await this.command.execStepInstruction()
    } else {
      await this.command.execStep()
    }
  }

  async command_stepOut(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) {
    await this.command.execFinish()
  }

  private readonly breakpointMap = new Map<string, BreakpointInfo[]>()
  private readonly instructionBreakpoints: BreakpointInfo[] = []

  async command_setBreakpoints(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
    response.body = {
      breakpoints: [],
    }

    const { breakpoints = [], source: { path = '<unknown>' } } = args
    const current = this.breakpointMap.get(path) ?? []
    this.breakpointMap.set(path, current)

    await this.setBreakpoints(
      response.body.breakpoints,
      breakpoints,
      current,
      (s, b) => s.line === b.line,
      s => this.command.breakInsert(undefined, { source: path, line: s.line }),
    )
  }

  async command_setInstructionBreakpoints(response: DebugProtocol.SetInstructionBreakpointsResponse, args: DebugProtocol.SetInstructionBreakpointsArguments) {
    response.body = {
      breakpoints: [],
    }

    const { breakpoints = [] } = args

    function getLocation(s: DebugProtocol.InstructionBreakpoint) {
      if (!s.offset) {
        return `*${s.instructionReference}`
      } else if (s.offset > 0) {
        return `*(${s.instructionReference}+${s.offset.toString()})`
      } else {
        return `*(${s.instructionReference}${s.offset.toString()})`
      }
    }

    await this.setBreakpoints(
      response.body.breakpoints,
      breakpoints,
      this.instructionBreakpoints,
      (s, b) => getLocation(s) === b.originalLocation,
      s => this.command.breakInsert(getLocation(s)),
    )
  }

  private async setBreakpoints<TSourceBreakpoint>(
    resBreakpoints: DebugProtocol.Breakpoint[],
    wantedBreakpoints: TSourceBreakpoint[],
    currentBreakpoints: BreakpointInfo[],
    comparer: (source: TSourceBreakpoint, current: BreakpointInfo) => boolean,
    create: (source: TSourceBreakpoint) => Promise<BreakpointInsertCommandResult>,
  ) {
    // start by removing old breakpoints to make space
    const remove: BreakpointInfo[] = []
    const preserve: BreakpointInfo[] = []
    for (const bkpt of currentBreakpoints) {
      if (wantedBreakpoints.find(b => comparer(b, bkpt))) {
        preserve.push(bkpt)
      } else {
        remove.push(bkpt)
      }
    }

    if (remove.length) {
      await this.command.breakDelete(...remove.map(b => b.number))
      // set the current breakpoints to what's left
      currentBreakpoints.splice(0, currentBreakpoints.length, ...preserve)
    }

    // add new breakpoints or match existing ones
    for (const bkpt of wantedBreakpoints) {
      const existing = currentBreakpoints.find(b => comparer(bkpt, b))
      if (existing) {
        resBreakpoints.push({
          verified: true,
          id: existing.number,
        })
        continue
      }

      try {
        const res = await create(bkpt)
        currentBreakpoints.push(res.bkpt)
        resBreakpoints.push({
          verified: true,
          id: res.bkpt.number,
          line: res.bkpt.line,
          message: res.bkpt.func,
        })
      } catch (err) {
        resBreakpoints.push({
          verified: false,
          message: err instanceof MiError ? err.result.msg : String(err),
        })
      }
    }
  }

  async command_disassemble(response: DebugProtocol.DisassembleResponse, args: DebugProtocol.DisassembleArguments) {
    const base = parseInt(args.memoryReference) + (args.offset ?? 0)
    if (Number.isNaN(base)) {
      throw new DebugError('Invalid disassembly address: {base}', { base }, undefined, ErrorCode.DisassemblyBadRequest)
    }

    const cache = this.disassemblyCache ??= new DisassemblyCache(this.command)
    const res = await cache.fill(base, args.instructionOffset ?? 0, args.instructionCount)
    response.body = {
      instructions: res.map(mapInstruction),
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
