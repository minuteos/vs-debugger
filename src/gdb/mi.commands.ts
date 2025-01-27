export interface MiResult {
  $class: string
  [key: string]: unknown
}

export type MiNotify = MiResult
export type MiStatus = MiResult
export type MiExecStatus = MiResult

export interface MiCommandResult extends MiResult {
  $notify?: MiNotify[]
}

export interface MiCommands {
  targetSelect(type: 'extended-remote', address: string): Promise<MiCommandResult>
  interpreterExec(...command: string[]): Promise<MiCommandResult>

  // breakpoint commands
  breakAfter(breakpoint: number, count: number): Promise<MiCommandResult>
  breakCommands(breakpoint: number, ...commands: string[]): Promise<MiCommandResult>
  breakCondition(breakpoint: number, expression?: string, opts?: { force?: boolean }): Promise<MiCommandResult>
  breakDelete(...breakpoins: number[]): Promise<MiCommandResult>
  breakDisable(...breakpoins: number[]): Promise<MiCommandResult>
  breakEnable(...breakpoins: number[]): Promise<MiCommandResult>
  breakInfo(breakpoint: number): Promise<BreakpointInfoCommandResult>
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
  data: { breakpointTable: BreakpointTable, body: BreakpointInfo[] }
}
