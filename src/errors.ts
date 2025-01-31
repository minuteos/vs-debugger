import { MiCommandErrorResult } from '@my/gdb/mi.commands'

export enum ErrorCode {
  LaunchError = 100,
  EvaluationError = 110,
  ConsoleEvaluationError = 111,
  DisassemblyBadRequest = 120,

  BmpScanError = 200,

  Internal = 900,
  Unknown = 999,
}

/** Same as VS Code destination bits */
export enum ErrorDestination {
  None = 0,
  User = 1,
  Telemetry = 2,
  All = 3,
}

export class DebugError extends Error {
  constructor(public format: string, readonly variables: Record<string, unknown> = {}, public destination = ErrorDestination.All, public code = ErrorCode.Unknown) {
    const message = format.replace(/{([^}]+)}/g, (match: string, name: string) =>
      name in variables ? JSON.stringify(variables[name]) : match,
    )
    super(message)
    this.name = 'DebugError'
  }

  get userVisible() { return !!(this.destination & ErrorDestination.User) }
  set userVisible(value: boolean) {
    if (value) {
      this.destination |= ErrorDestination.User
    } else {
      this.destination &= ~ErrorDestination.User
    }
  }

  get telemetry() { return !!(this.destination & ErrorDestination.Telemetry) }
  set telemetry(value: boolean) {
    if (value) {
      this.destination |= ErrorDestination.Telemetry
    } else {
      this.destination &= ~ErrorDestination.Telemetry
    }
  }
}

export class MiError extends DebugError {
  constructor(readonly result: MiCommandErrorResult, public destination = ErrorDestination.All, public code = ErrorCode.Unknown) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { $class, $notify, $output, $console, ...vars } = result
    super('{msg}', vars, destination, code)
    this.name = 'MiError'
  }
}

export function configureError<T>(error: T, code?: ErrorCode, destination?: ErrorDestination) {
  if (error instanceof DebugError) {
    if (code !== undefined) {
      error.code = code
    }
    if (destination !== undefined) {
      error.destination = destination
    }
  }
  return error
}
