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
}

export interface MiCommands {
  targetSelect(type: 'extended-remote', address: string): Promise<MiCommandResult>
  interpreterExec(interpreter: 'console', ...command: string[]): Promise<MiCommandResult>

  // breakpoint commands
  breakAfter(breakpoint: number, count: number): Promise<MiCommandResult>
  breakCommands(breakpoint: number, ...commands: string[]): Promise<MiCommandResult>
  breakCondition(breakpoint: number, expression?: string, opts?: { force?: boolean }): Promise<MiCommandResult>
  breakDelete(...breakpoins: number[]): Promise<MiCommandResult>
  breakDisable(...breakpoins: number[]): Promise<MiCommandResult>
  breakEnable(...breakpoins: number[]): Promise<MiCommandResult>
  breakInfo(breakpoint: number): Promise<BreakpointInfoCommandResult>

  // thread commands
  threadInfo(threadId?: number): Promise<ThreadInfoCommandResult>
  threadSelect(threadId: number): Promise<ThreadSelectCommandResult>

  // stack commands
  stackListFrames(lowFrame?: number, highFrame?: number, opts?: { noFrameFilters: boolean }): Promise<StackListFramesCommandResult>
}

export interface BreakpointInfo {
  bkpt: number
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
