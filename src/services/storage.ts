import { getLog } from '@my/services/log'
import * as vscode from 'vscode'

const log = getLog('storage')

export enum StorageScope {
  Workspace, Global,
}

export interface StorageBlob {
  timestamp: number
  content: Uint8Array
}

interface StorageSection {
  path: string
  scope: StorageScope
}

interface StorageProvider {
  getObject<T>(section: StorageSection, key: string): Promise<T | undefined>
  setObject(section: StorageSection, key: string, value: unknown): Promise<void>
  getBlob(section: StorageSection, path: string): Promise<StorageBlob | undefined>
  setBlob(section: StorageSection, path: string, content: Uint8Array | undefined): Promise<void>
}

export interface Storage {
  getObject<T>(key: string): Promise<T | undefined>
  setObject(key: string, value: unknown): Promise<void>
  getBlob(path: string): Promise<StorageBlob | undefined>
  setBlob(path: string, content: Uint8Array | undefined): Promise<void>
}

class NullStorageProvider implements StorageProvider {
  getObject(): Promise<undefined> {
    return Promise.resolve(undefined)
  }

  setObject(): Promise<void> {
    return Promise.resolve()
  }

  getBlob(): Promise<undefined> {
    return Promise.resolve(undefined)
  }

  setBlob(): Promise<void> {
    return Promise.resolve()
  }
}

class StorageImpl implements Storage, StorageSection {
  constructor(readonly path: string, readonly scope: StorageScope) {
  }

  getObject<T>(key: string): Promise<T | undefined> {
    return provider.getObject(this, key)
  }

  setObject(key: string, value: unknown): Promise<void> {
    return provider.setObject(this, key, value)
  }

  getBlob(path: string): Promise<StorageBlob | undefined> {
    return provider.getBlob(this, path)
  }

  setBlob(path: string, content: Uint8Array | undefined): Promise<void> {
    return provider.setBlob(this, path, content)
  }
}

let provider: StorageProvider = new NullStorageProvider()
export function getStorage(name: string, scope: StorageScope): Storage {
  return new StorageImpl(name, scope)
}

class CodeStorageProvider implements StorageProvider {
  constructor(private readonly context: vscode.ExtensionContext) {
  }

  private getState(scope: StorageScope) {
    return scope === StorageScope.Workspace ? this.context.workspaceState : this.context.globalState
  }

  private getStorage(scope: StorageScope) {
    return scope === StorageScope.Workspace && this.context.storageUri ? this.context.storageUri : this.context.globalStorageUri
  }

  getObject<T>(section: StorageSection, key: string): Promise<T | undefined> {
    return Promise.resolve(this.getState(section.scope).get<T>(`${section.path}/${key}`))
  }

  async setObject(section: StorageSection, key: string, value: unknown): Promise<void> {
    await this.getState(section.scope).update(`${section.path}/${key}`, value)
  }

  async getBlob(section: StorageSection, path: string): Promise<StorageBlob | undefined> {
    const uri = vscode.Uri.joinPath(this.getStorage(section.scope), section.path, path)
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      const file = await vscode.workspace.fs.readFile(uri)
      return {
        timestamp: stat.mtime,
        content: file,
      }
    } catch (err) {
      const scopeName = StorageScope[section.scope]
      const errPath = `${section.path}/${path}`
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        log.warn('Blob not found in', scopeName, 'storage:', errPath)
      } else {
        log.error('Failed to get blob', errPath, 'from', scopeName, 'storage', err)
      }
      return undefined
    }
  }

  async setBlob(section: StorageSection, path: string, content?: Uint8Array): Promise<void> {
    const uri = vscode.Uri.joinPath(this.getStorage(section.scope), section.path, path)
    try {
      if (content) {
        await vscode.workspace.fs.writeFile(uri, content)
      } else {
        await vscode.workspace.fs.delete(uri)
      }
    } catch (err) {
      const scopeName = StorageScope[section.scope]
      const errPath = `${section.path}/${path}`
      log.error('Failed to store blob', errPath, 'to', scopeName, 'storage', err)
      throw err
    }
  }
}

export function configureVsCodeStorage(context: vscode.ExtensionContext) {
  provider = new CodeStorageProvider(context)
}
