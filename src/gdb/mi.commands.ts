export interface MiResult {
  $class: string
  [key: string]: unknown
}

export type MiNotify = MiResult
export type MiStatus = MiResult

// #region Exec status events
export interface RunningExecStatus extends MiResult {
  $class: 'running'
  threadId: number | 'all'
}

export type StoppedReason = 'breakpoint-hit'
  | 'watchpoint-trigger'
  | 'read-watchpoint-trigger'
  | 'access-watchpoint-trigger'
  | 'function-finished'
  | 'location-reached'
  | 'watchpoint-scope'
  | 'end-stepping-range'
  | 'exited-signalled'
  | 'exited'
  | 'exited-normally'
  | 'signal-received'

export interface StoppedExecStatus extends MiResult {
  $class: 'stopped'
  reason: StoppedReason
  threadId: number
  stoppedThreads: string
}

export type MiExecStatus = RunningExecStatus | StoppedExecStatus

// #endregion

export interface MiCommandResult extends MiResult {
  $notify?: MiNotify[]
  $output?: string
  $console?: string
}

export interface MiCommandErrorResult extends MiCommandResult {
  $class: 'error'
  msg: string
}

export interface MiCommandNonErrorResult extends MiCommandResult {
  $class: 'done'
}

export type MiCommandMaybeErrorResult = MiCommandNonErrorResult | MiCommandErrorResult

interface ExecReverseOptions {
  reverse?: boolean
}

interface ExecThreadGroupOptions {
  all?: boolean
  threadGroup?: number
}

interface BreakpointOptions {
  source?: string
  function?: string
  label?: string
  line?: number
  t?: boolean /** temporary */
  h?: boolean /** hardware */
  f?: boolean /** force creation if locspec cannot be parsed */
  d?: boolean /** create disabled */
  a?: boolean /** create tracepoint */
  c?: string /** conditional */
  forceCondition?: boolean
  i?: number /** ignore count */
  p?: number /** thread ID */
  g?: string /** thread group ID */
  qualified?: boolean /** function name is fully qualified */
}

export interface MiCommands {
  targetSelect(type: 'extended-remote', address: string): Promise<MiCommandResult>
  gdbSet(option: 'mi-async', value: unknown): Promise<MiCommandResult>
  interpreterExec(interpreter: 'console', ...command: string[]): Promise<MiCommandResult>

  // breakpoint commands
  breakAfter(breakpoint: number, count: number): Promise<MiCommandResult>
  breakCommands(breakpoint: number, ...commands: string[]): Promise<MiCommandResult>
  breakCondition(breakpoint: number, expression?: string, opts?: { force?: boolean }): Promise<MiCommandResult>
  breakDelete(...breakpoins: number[]): Promise<MiCommandResult>
  breakDisable(...breakpoins: number[]): Promise<MiCommandResult>
  breakEnable(...breakpoins: number[]): Promise<MiCommandResult>
  breakInfo(breakpoint: number): Promise<BreakpointInfoCommandResult>
  breakInsert(locspec?: string, opts?: BreakpointOptions): Promise<BreakpointInsertCommandResult>

  // thread commands
  threadInfo(threadId?: number): Promise<ThreadInfoCommandResult>
  threadSelect(threadId: number): Promise<ThreadSelectCommandResult>

  // stack commands
  stackListFrames(lowFrame?: number, highFrame?: number, opts?: { noFrameFilters: boolean }): Promise<StackListFramesCommandResult>

  // variable commands
  varCreate(name: string, frameAddr: string, expression: string): Promise<VariableCreateCommandResult>

  // exec commands
  execContinue(opts?: ExecReverseOptions & ExecThreadGroupOptions): Promise<MiCommandResult>
  execFinish(opts?: ExecReverseOptions): Promise<MiCommandResult>
  execInterrupt(opts?: ExecReverseOptions & ExecThreadGroupOptions): Promise<MiCommandResult>
  execJump(location: string): Promise<MiCommandResult>
  execNext(opts?: ExecReverseOptions): Promise<MiCommandResult>
  execNextInstruction(opts?: ExecReverseOptions): Promise<MiCommandResult>
  execReturn(): Promise<MiCommandResult>
  execRun(opts?: ExecThreadGroupOptions & { start?: boolean }): Promise<MiCommandResult>
  execStep(opts?: ExecReverseOptions): Promise<MiCommandResult>
  execStepInstruction(opts?: ExecReverseOptions): Promise<MiCommandResult>
  execUntil(location: string): Promise<MiCommandResult>
}

export interface BreakpointInfo {
  number: number
  type: 'breakpoint'
  disp: 'keep'
  enabled: 'y'
  addr: string
  func: string
  file: string
  fullname: string
  line: number
  threadGroups: string[]
  times: number
}

export interface BreakpointTable {
  nrRows: number
  nrCols: number
  hdr: {
    width: number
    alignment: number
    colName: string
    colhdr: string
  }[]
}

export interface BreakpointInfoCommandResult extends MiCommandResult {
  breakpointTable: BreakpointTable
  body: BreakpointInfo[]
}

export interface BreakpointInsertCommandResult extends MiCommandResult {
  bkpt: BreakpointInfo
}

export interface FrameInfo {
  level: number
  addr: string
  func: string
  args: unknown[]
  file?: string
  fullname?: string
  line?: number
  column?: number
  arch?: string
}

export type ThreadState = 'running' | 'stopped'

export interface ThreadInfo {
  id: number
  targetId: string
  frame: FrameInfo
  state: ThreadState
  details?: string
}

export interface ThreadInfoCommandResult extends MiCommandResult {
  threads: ThreadInfo[]
  currentThreadId: number
}

export interface ThreadSelectCommandResult extends MiCommandResult {
  newThreadId: number
}

export interface StackListFramesCommandResult extends MiCommandResult {
  stack: FrameInfo[]
}

export interface VariableCreateCommandResult extends MiCommandResult {
  name: string
  numchild: number
  value: string
  type: string
  threadId?: number
  hasMore?: number
  dynamic?: number
  displayhint?: string
}
