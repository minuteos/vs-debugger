export interface MiResult {
  $class: string
  $results?: unknown[]
  [key: string]: unknown
}

export interface MiThreadNotify extends MiResult {
  id: number
  groupId: string
}

export interface MiThreadCreateNotify extends MiThreadNotify {
  $class: 'thread-created'
}

export interface MiThreadExitedNotify extends MiThreadNotify {
  $class: 'thread-exited'
}

export interface MiOtherNotify extends MiResult {
  $class: ''
}

export type MiNotify = MiThreadNotify | MiThreadExitedNotify | MiOtherNotify

export interface DownloadStatus {
  $class: 'download'
  section: string
  sectionSize: number
  sectionSent: number
  totalSize: number
  totalSent: number
}

export type MiStatus = DownloadStatus

// #region Exec status events
export interface RunningExecStatus extends MiResult {
  $class: 'running'
  threadId: number
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
  | 'new'

export interface StoppedExecStatus extends MiResult {
  $class: 'stopped'
  reason: StoppedReason
  threadId: number
  stoppedThreads?: string
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

interface PrintValuesOptions {
  noValues?: boolean
  allValues?: boolean
  simpleValues?: boolean
}

interface ThreadFrameOptions {
  thread?: number
  frame?: number
}

interface StackListVariablesOptions extends ThreadFrameOptions, PrintValuesOptions {
  noFrameFilters?: boolean
  skipUnavailable?: boolean
}

interface DisassemblyRangeTarget {
  s: number /** start */
  e: number /** end */
}

interface DisassemblyAddressTarget {
  a: number /** address */
}

interface DisassemblyFunctionTarget {
  f: string /** filename */
  l: number /** line */
  n?: number /** count */
}
type DisassemblyTarget = DisassemblyRangeTarget | DisassemblyAddressTarget | DisassemblyFunctionTarget

type DisassemblyOptions = DisassemblyTarget & {
  opcodes: 'none' | 'bytes' | 'display'
  source: boolean
}

interface SymbolInfoVariablesOptions {
  includeNondebug?: boolean
  type?: string /** regexp */
  name?: string /** regexp */
  maxResults?: number
}

export interface CommandEvents {
  status: (status: MiStatus) => void
}

export enum ValueFormat {
  Hexadecimal = 'x',
  Octal = 'o',
  Binary = 't',
  Decimal = 'd',
  Raw = 'r',
  Natural = 'N',
}

export interface MiCommands {
  targetSelect(type: 'extended-remote', address: string): Promise<MiCommandResult>
  targetAttach(target: number | string): Promise<MiCommandResult>
  targetDownload($onStatus: (status: DownloadStatus) => void): Promise<MiCommandResult>
  gdbSet(...optionAndValue: unknown[]): Promise<MiCommandResult>
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
  stackListVariables(opts?: StackListVariablesOptions): Promise<StackListVariablesCommandResult>

  // variable commands
  varCreate(opts: ThreadFrameOptions, name: string, frameAddr: string, expression: string): Promise<VariableCreateCommandResult>
  varDelete(name: string): Promise<MiCommandResult>
  varListChildren(opts: PrintValuesOptions, name: string, from?: number, to?: number): Promise<VariableListChildrenCommandResult>

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

  // data commands
  dataDisassemble(opts: DisassemblyOptions): Promise<DisassemblyResult>
  dataReadMemoryBytes(addr: number, len: number): Promise<DataReadResult>
  dataWriteMemoryBytes(addr: number, contents: string): Promise<DataReadResult>
  dataListRegisterNames(): Promise<RegisterNamesResult>
  dataListRegisterValues(opts: { skipUnavailable?: boolean }, format: ValueFormat): Promise<RegisterValuesResult>

  // symbol commands
  symbolInfoVariables(opts?: SymbolInfoVariablesOptions): Promise<SymbolInfoVariablesResult>

  // custom commands
  console(...command: string[]): Promise<MiCommandResult>
  monitor(...command: string[]): Promise<MiCommandResult>
  readMemory(addr: number, len: number): Promise<Buffer>
  writeMemory(addr: number, data: Buffer): Promise<void>
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
  originalLocation: string
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

export interface StackListVariablesCommandResult extends MiCommandResult {
  variables: {
    name: string
    type: string
    value: string | number
  }[]
}

export interface VariableCreateCommandResult extends MiCommandResult, VariableInfo {
  threadId?: number
  hasMore?: number
  dynamic?: number
  displayhint?: string
}

export interface VariableInfo {
  name: string
  numchild: number
  value: string | number
  type?: string
}

export interface VariableListChildrenCommandResult extends MiCommandResult {
  numchildren: number
  children: ({
    exp: string | number
  } & VariableInfo)[]
}

export interface DisassemblyInstruction {
  address: string
  funcName: string
  offset: number
  opcodes: string
  inst: string
}

export interface DisassemblySourceInstruction {
  $type: 'src_and_asm_line'
  line: number
  file: string
  fullname: string
  line_asm_insn?: DisassemblyInstruction[]
}

export interface DisassemblyResult extends MiCommandResult {
  asm_insns: DisassemblySourceInstruction[] | DisassemblyInstruction[]
}

export interface DataReadResult extends MiCommandResult {
  memory: {
    begin: string
    end: string
    offset: string
    contents: string
  }[]
}

export interface RegisterNamesResult extends MiCommandResult {
  registerNames: string[]
}

export interface RegisterValuesResult extends MiCommandResult {
  registerValues: {
    number: number
    value: number | string
  }[]
}

export interface DebugFileInfo {
  filename: string
  fullname: string
  symbols: DebugFileSymbolInfo[]
}

export interface DebugFileSymbolInfo {
  line: number
  name: string
  type: string
  description: string
}

interface NonDebugSymbolInfo {
  address: string
  name: string
}

export interface SymbolInfoVariablesResult extends MiCommandResult {
  symbols: {
    debug: DebugFileInfo[]
    nondebug?: NonDebugSymbolInfo[]
  }
}
