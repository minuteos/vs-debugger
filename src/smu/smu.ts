export abstract class Smu extends AsyncDisposableStack {
  abstract connect(): Promise<void>
}
