import { DisposableContainer } from '@my/util'

export class Plugin<TOptions> extends DisposableContainer {
  constructor(protected readonly options: TOptions) {
    super()
  }
}
