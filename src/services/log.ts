import * as vscode from 'vscode'

/**
 * Simple logger interface, compatible with the global console
 */
export interface Logger {
  /**
   * Logs a message at the error level
   * @param args Log content
   */
  error(...args: unknown[]): void

  /**
   * Logs a message at the warning level
   * @param args Log content
   */
  warn(...args: unknown[]): void

  /**
   * Logs a message at the info level
   * @param args Log content
   */
  info(...args: unknown[]): void

  /**
   * Logs a message at the default level
   * @param args Log content
   */
  log(...args: unknown[]): void

  /**
   * Logs a message at the debug level
   * @param args Log content
   */
  debug(...args: unknown[]): void

  /**
   * Logs a message at the trace level
   * @param args Log content
   */
  trace(...args: unknown[]): void
}

export type LogLevel = 'error' | 'warn' | 'info' | 'log' | 'debug' | 'trace'

export class CallbackLogger implements Logger {
  constructor(readonly callback: (level: LogLevel, ...args: unknown[]) => void) {}

  error(...args: unknown[]): void {
    this.handle('error', ...args)
  }

  warn(...args: unknown[]): void {
    this.handle('warn', ...args)
  }

  info(...args: unknown[]): void {
    this.handle('info', ...args)
  }

  log(...args: unknown[]): void {
    this.handle('log', ...args)
  }

  debug(...args: unknown[]): void {
    this.handle('debug', ...args)
  }

  trace(...args: unknown[]): void {
    this.handle('trace', ...args)
  }

  private handle(level: LogLevel, ...args: unknown[]) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg instanceof Error && arg.stack) {
        args[i] = arg.stack
      }
    }
    this.callback(level, ...args)
  }
}

const logOutputChannel = vscode.window.createOutputChannel('minuteDebug', {
  log: true })

export const log: Logger = new CallbackLogger((level, ...args) => {
  if (level !== 'trace') {
    // do not log trace to VS Code console
    console[level](...args)
  }
  if (level === 'log') {
    // log output channel doesn't support a 'default' log level
    level = 'info'
  }
  const [message, ...rest] = args
  logOutputChannel[level](String(message), ...rest)
})

export function getLog(category: string, parent?: Logger): Logger {
  parent ??= log
  category = `[${category}]`
  return new CallbackLogger((level, ...args) => {
    parent[level](category, ...args)
  })
}

export function getExtraLog(name: string): Logger {
  const channel = vscode.window.createOutputChannel(`minuteDebug - ${name}`, {
    log: true })
  return new CallbackLogger((level, ...args) => {
    if (level === 'log') {
      // log output channel doesn't support a 'default' log level
      level = 'info'
    }
    const [message, ...rest] = args
    channel[level](String(message), ...rest)
  })
}

export function getRawLog(name: string): (text: string) => void {
  const channel = vscode.window.createOutputChannel(`minuteDebug - ${name}`)
  return (text) => {
    channel.append(text)
  }
}
