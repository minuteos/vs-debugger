import { expandConfiguration, InputLaunchConfiguration, LaunchConfiguration } from '@my/configuration'
import { configureError, DebugError, ErrorCode, ErrorDestination, MiError } from '@my/errors'
import { createGdbServer } from '@my/gdb-server/factory'
import { GdbServer } from '@my/gdb-server/gdb-server'
import { GdbInstance } from '@my/gdb/instance'
import { BreakpointInfo, BreakpointInsertCommandResult, DebugFileInfo as DebugFileInfo, DebugFileSymbolInfo, FrameInfo, MiCommands, MiExecStatus, ValueFormat, VariableInfo } from '@my/gdb/mi.commands'
import { SwoSession } from '@my/gdb/swo'
import { getLog, getTrace, progress, traceEnabled } from '@my/services'
import { createSmu } from '@my/smu/factory'
import { Smu } from '@my/smu/smu'
import { findExecutable, throwError } from '@my/util'
import { ContinuedEvent, DebugSession, InitializedEvent, Response, Scope, StoppedEvent, Variable } from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'

import { DisassemblyCache } from './disassembly'
import * as mi from './mi.mappings'
import { smartLoadSkip } from './smart-load'

type DebugHandler = (response: DebugProtocol.Response, args: unknown, request: DebugProtocol.Request) => Promise<string | boolean>
type DebugHandlers = Record<string, DebugHandler>

const log = getLog('DebugSession')
const trace = getTrace('DAP')

/**
 * Fake variable reference numbers for the scopes
 */
enum VariableScope {
  Local = 4000000000,
  Global,
  Registers,
}

interface GlobalVariable {
  file: DebugFileInfo
  sym: DebugFileSymbolInfo
  variable: GdbVariable
}

class GdbVariable {
  readonly displayName: string
  readonly name: string
  readonly type?: string
  value = ''
  expandable = false
  presentationHint?: DebugProtocol.VariablePresentationHint

  constructor(displayName: string | number, vi: VariableInfo, readonly ref: number) {
    this.displayName = displayName.toString()
    this.name = vi.name
    this.type = vi.type
    this.update(vi.value, vi.numchild)
  }

  update(value: string | number, numChildren: number) {
    if (this.type && this.type.endsWith('*') && (value === 0 || (typeof value === 'string' && parseInt(value) === 0))) {
      this.value = 'NULL'
      this.expandable = false
    } else {
      this.value = value.toString()
      this.expandable = !!numChildren
    }
  }

  toVariable(): Variable {
    const res = new Variable(
      this.displayName,
      this.value,
      this.expandable ? this.ref : 0) as DebugProtocol.Variable

    if (this.presentationHint) {
      res.presentationHint = this.presentationHint
    }
    return res
  }
}

function symbolReference(file: DebugFileInfo, sym: DebugFileSymbolInfo) {
  let { name } = sym
  if (/[:<>()]/.exec(name)) {
    // quote name as well if it contains special characters
    name = `'${name}'`
  }
  return `'${file.filename}'::${name}`
}

export class MinuteDebugSession extends DebugSession {
  private gdb?: GdbInstance
  private server?: GdbServer
  private smu?: Smu
  private disassemblyCache?: DisassemblyCache
  private disposableStack = new AsyncDisposableStack()
  private suppressExecEvents = true
  private lastExecEvent?: ContinuedEvent | StoppedEvent
  private varMap = new Map<string | number, GdbVariable>()
  private varNextRef = 1

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
    await this.disposableStack.disposeAsync()
  }

  private getVar(nameOrRef: string | number): GdbVariable {
    return this.varMap.get(nameOrRef) ?? throwError(new Error(`Unknown variable '${nameOrRef.toString()}'`))
  }

  private registerVar(displayName: string | number, vi: VariableInfo): GdbVariable {
    const v = new GdbVariable(displayName, vi, this.varNextRef++)
    this.varMap.set(v.name, v)
    this.varMap.set(v.ref, v)
    return v
  }

  private deleteVar(v: GdbVariable) {
    this.varMap.delete(v.name)
    this.varMap.delete(v.ref)
  }

  // #region Command handlers
  /* eslint-disable @typescript-eslint/no-unused-vars */

  command_initialize(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
    response.body = {
      supportsSteppingGranularity: true,
      supportsDisassembleRequest: true,
      supportsInstructionBreakpoints: true,
      supportsValueFormattingOptions: true,
    }
  }

  async command_launch(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments) {
    await this.launchOrAttach(expandConfiguration(args as InputLaunchConfiguration), true)
  }

  async command_attach(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments) {
    await this.launchOrAttach(expandConfiguration(args as InputLaunchConfiguration), false)
  }

  private async launchOrAttach(config: LaunchConfiguration, loadProgram: boolean) {
    this.gdb = this.disposableStack.use(new GdbInstance(config, (exec) => {
      this.execStatusChange(exec)
    }))
    this.server = this.disposableStack.use(createGdbServer(config))
    this.smu = this.disposableStack.use(createSmu(config))
    await Promise.all([
      this.gdb.start(await findExecutable('arm-none-eabi-gdb')),
      this.server.start(),
      this.smu?.connect(),
    ])

    await this.command.gdbSet('mi-async', 1)
    await this.command.gdbSet('mem', 'inaccessible-by-default', 0)
    await this.command.targetSelect('extended-remote', this.server.address)

    await this.server.attach(this.command)

    if (this.server.swoStream) {
      const swo = this.disposableStack.use(new SwoSession(this.command, this.server.swoStream, (swo) => {
        if (!swo.dwt && swo.ch === 0) {
          vscode.debug.activeDebugConsole.append(swo.data.toString())
        }
      }))
      await swo.start()
    }

    if (loadProgram && !this.server.skipLoad) {
      if (config.smartLoad
        && this.server.identity
        && await smartLoadSkip(config.cwd, config.program, this.server.identity)) {
        log.info('SmartLoad: program already loaded')
      } else {
        await progress('Loading program', async (p) => {
          await this.command.targetDownload((status) => {
            p.report(`section ${status.section}`, status.sectionSent / status.sectionSize)
          })
        })
      }
      await this.command.console('starti')
    }

    this.sendEvent(new InitializedEvent())
    this.suppressExecEvents = false
    if (this.lastExecEvent) {
      this.sendEvent(this.lastExecEvent)
    }
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

  async command_evaluate(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
    const addr = (args.frameId ? this.frameIdMap.get(args.frameId)?.addr : undefined) ?? '*'

    if (args.context === 'repl' && args.expression.startsWith('>')) {
      // execute console command
      try {
        const res = await this.command.console(args.expression.substring(1))
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
      try {
        const res = await this.command.varCreate('-', addr, args.expression)
        if (res.numchild) {
          response.body = {
            result: String(res.value),
            variablesReference: this.registerVar(args.expression, res).ref,
          }
        } else {
          await this.command.varDelete(res.name)
        }
      } catch (error) {
        throw configureError(error, ErrorCode.EvaluationError, ErrorDestination.None)
      }
    }
  }

  command_scopes(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
    response.body = {
      scopes: [
        new Scope('Local', VariableScope.Local, false),
        new Scope('Global', VariableScope.Global, true),
        new Scope('Registers', VariableScope.Registers, true),
      ],
    }
  }

  private registerNames?: string[]
  private debugSymbols?: DebugFileInfo[]
  private globalVars?: GlobalVariable[]

  private async getDebugSymbols() {
    return this.debugSymbols ??= (await this.command.symbolInfoVariables()).symbols.debug
  }

  private async getGlobalVariables() {
    return this.globalVars ??= await this.createGlobalVariables()
  }

  private async createGlobalVariables() {
    const res: GlobalVariable[] = []

    for (const file of await this.getDebugSymbols()) {
      for (const sym of file.symbols) {
        if (sym.description.startsWith('static ')) {
          continue
        }

        try {
          const variable = await this.command.varCreate('-', '0', symbolReference(file, sym))
          res.push({ file, sym, variable: this.registerVar(sym.name, variable) })
        } catch (error) {
          log.warn('Failed to create global variable', error)
        }
      }
    }

    return res
  }

  async command_variables(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
    let variables: Variable[] = []

    switch (args.variablesReference as VariableScope) {
      case VariableScope.Local: {
        const vars = await this.command.stackListVariables({ simpleValues: true })
        variables = vars.variables.map(({ name, value }) => new Variable(name, value.toString()))
        break
      }

      case VariableScope.Global: {
        const globals = await this.getGlobalVariables()
        variables = globals.map(g => g.variable.toVariable())
        break
      }

      case VariableScope.Registers: {
        // special case
        const registerNames = this.registerNames ??= (await this.command.dataListRegisterNames()).registerNames
        const values = await this.command.dataListRegisterValues({ skipUnavailable: true },
          args.format?.hex ? ValueFormat.Hexadecimal : ValueFormat.Natural)
        variables = values.registerValues.map(({ number, value }) => new Variable(registerNames[number], value.toString()))
        break
      }

      default: {
        const res = await this.command.varListChildren({
          allValues: true,
        }, this.getVar(args.variablesReference).name)

        for (const v of res.children) {
          const gv = this.registerVar(String(v.exp), v)
          if (v.type === undefined && typeof v.exp === 'string' && ['public', 'protected', 'private', 'internal'].includes(v.exp)) {
            // turn access modifiers into presentation hints
            const ph: DebugProtocol.VariablePresentationHint = { visibility: v.exp !== 'public' ? 'internal' : v.exp }
            for (const vv of (await this.command.varListChildren({ allValues: true }, v.name)).children) {
              const gvv = this.registerVar(String(vv.exp), vv)
              gvv.presentationHint = ph
              variables.push(gvv.toVariable())
            }
          } else {
            variables.push(gv.toVariable())
          }
        }
        break
      }
    }
    response.body = {
      variables,
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

  command_setExceptionBreakpoints(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments) {
    // no support yet
    response.body = {
      breakpoints: [],
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
      instructions: res.map(mi.mapInstruction),
    }
  }

  /* eslint-enable @typescript-eslint/no-unused-vars */
  // #endregion

  // #region Execution status changes

  private execStatusChange(evt: MiExecStatus) {
    switch (evt.$class) {
      case 'running':
        if (evt.threadId === 'all') {
          this.lastExecEvent = new ContinuedEvent(0, true)
        } else {
          this.lastExecEvent = new ContinuedEvent(evt.threadId)
        }
        break
      case 'stopped':
        this.lastExecEvent = new StoppedEvent(evt.reason, evt.threadId)
        break
    }

    if (!this.suppressExecEvents) {
      this.sendEvent(this.lastExecEvent)
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
