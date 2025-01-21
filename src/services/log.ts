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
}

export const log: Logger = console
