export enum ErrorCode {
  LaunchError = 100,

  Unknown = 999,
}

export class DebugError extends Error {
  constructor(readonly code: ErrorCode, readonly format: string, readonly variables: object) {
    super(format)
    this.name = 'DebugError'
  }
}
