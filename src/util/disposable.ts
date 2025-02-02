export class DisposableContainer implements AsyncDisposable {
  [Symbol.asyncDispose](): PromiseLike<void> {
    return this._d.disposeAsync()
  }

  protected use<T extends AsyncDisposable | Disposable | null | undefined>(value: T): T {
    return this._d.use(value)
  }

  protected adopt<T>(value: T, onDisposeAsync: (value: T) => PromiseLike<void> | void): T {
    return this._d.adopt(value, onDisposeAsync)
  }

  protected defer(onDisposeAsync: () => PromiseLike<void> | void): void {
    this._d.defer(onDisposeAsync)
  }

  protected set<T, K extends keyof T>(target: T, key: K, value: T[K]) {
    target[key] = value
    this._d.defer(() => {
      target[key] = undefined as T[K]
    })
  }

  protected readonly _d = new AsyncDisposableStack()
}
