import * as vscode from 'vscode'

/**
 * Interface for reporting progress of long running tasks
 */
export interface Progress {
  /**
   * @param message Progress message
   * @param progress Progress as a number between 0 and 1
   */
  report(message: string, progress?: number): void
}

async function vsCodeProgressImpl<T>(title: string, task: (progress: Progress) => Promise<T>): Promise<T> {
  return await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title,
  }, (vsProgress) => {
    let lastProgress = 0
    return task({
      report: (message, progress) => {
        let increment
        if (progress !== undefined) {
          // convert to percentage and calculate increment
          progress *= 100
          increment = Math.max(0, progress - lastProgress)
          lastProgress = progress
        }
        vsProgress.report({ message, increment })
      } })
  })
}

/**
 * Executes a long running task that is capable of reporting progress
 * @param title Display name of the task being executed
 * @param task Function implementing the task
 */
export const progress = vsCodeProgressImpl
