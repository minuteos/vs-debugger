import { MiResult } from './mi.commands'

export enum MiStreamType {
  Console = '~',
  Target = '@',
  Log = '&',
}

export enum MiEventType {
  Exec = '*',
  Status = '+',
  Notify = '=',
}

export interface MiEvent extends MiResult {
  type: MiEventType
}

export interface ThreadEvent extends MiEvent {
  type: MiEventType.Notify
  class: 'thread-status'
}
