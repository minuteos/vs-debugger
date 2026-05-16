import { getLog } from '@my/services'
import { allocateTcpPort, DisposableContainer, promiseWithResolvers } from '@my/util'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { createServer, Server, Socket } from 'net'
import os from 'os'
import path from 'path'
import * as vscode from 'vscode'

import framebufferSource from './renode-framebuffer.cs'

const log = getLog('Display')

const LOCALHOST = '127.0.0.1'

// [width u32][height u32][byteLength u32] little-endian, then RGBA8888 pixels.
const HEADER = 12

const HTML = `<!doctype html><html><body style="margin:0;background:#000;display:grid;place-items:center;height:100vh">
<canvas id="c" style="image-rendering:pixelated;max-width:100%;max-height:100%"></canvas>
<script>
const c = document.getElementById('c'), ctx = c.getContext('2d')
addEventListener('message', (e) => {
  const { width, height, data } = e.data
  if (c.width !== width || c.height !== height) { c.width = width; c.height = height }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
})
</script></body></html>`

// The panel outlives a single debug session: relaunching reuses (and
// reveals) it instead of stacking a fresh tab on every launch.
let sharedPanel: vscode.WebviewPanel | undefined

function acquirePanel(): vscode.WebviewPanel {
  if (sharedPanel) {
    sharedPanel.reveal(undefined, true)
    return sharedPanel
  }

  const panel = vscode.window.createWebviewPanel(
    'minuteDebug.display',
    'Renode Display',
    { preserveFocus: true, viewColumn: vscode.ViewColumn.Beside },
    { enableScripts: true, retainContextWhenHidden: true },
  )
  panel.webview.html = HTML
  panel.onDidDispose(() => {
    sharedPanel = undefined
  })
  sharedPanel = panel
  return panel
}

/**
 * Listens for the Renode framebuffer peripheral and renders frames into a
 * reusable webview editor tab.
 */
export class FramebufferDisplay extends DisposableContainer {
  private buffer = Buffer.alloc(0)
  port!: number

  async start(): Promise<void> {
    this.port = await allocateTcpPort()

    const server: Server = createServer((socket) => {
      this.receive(socket)
    })
    const { promise, resolve, reject } = promiseWithResolvers()
    server.once('error', reject)
    server.listen(this.port, LOCALHOST, () => {
      resolve()
    })
    await promise
    this.adopt(server, s => new Promise<void>((done) => {
      s.close(() => {
        done()
      })
    }))

    // The panel is intentionally not adopted: it survives session teardown.
    acquirePanel()
  }

  /**
   * Writes the C# tap and a `.repl` overlay that instantiates it against the
   * named video peripheral. Returns the paths for `includeFile` /
   * `loadPlatformOverlay`.
   */
  async materializeOverlay(videoRef: string): Promise<{ cs: string, repl: string }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'minute-renode-fb-'))
    this.defer(() => rm(dir, { force: true, recursive: true }))

    const cs = path.join(dir, 'MinuteFramebuffer.cs')
    const repl = path.join(dir, 'overlay.repl')
    await writeFile(cs, framebufferSource)
    await writeFile(
      repl,
      `fbBridge: Miscellaneous.MinuteFramebuffer @ none\n`
      + `    video: ${videoRef}\n`
      + `    port: ${this.port.toString()}\n`,
    )
    return { cs, repl }
  }

  private receive(socket: Socket) {
    log.debug('Renode framebuffer tap connected')
    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
      this.drain()
    })
    socket.on('error', (err) => {
      log.warn('Framebuffer socket error', err)
    })
  }

  private drain() {
    while (this.buffer.length >= HEADER) {
      const width = this.buffer.readUInt32LE(0)
      const height = this.buffer.readUInt32LE(4)
      const length = this.buffer.readUInt32LE(8)
      if (this.buffer.length < HEADER + length) {
        return
      }
      const data = new Uint8Array(this.buffer.subarray(HEADER, HEADER + length))
      void sharedPanel?.webview.postMessage({ data, height, width })
      this.buffer = this.buffer.subarray(HEADER + length)
    }
  }
}
