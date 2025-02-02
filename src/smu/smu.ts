import { DisposableContainer } from '@my/util'

export abstract class Smu extends DisposableContainer {
  abstract connect(): Promise<void>
}
