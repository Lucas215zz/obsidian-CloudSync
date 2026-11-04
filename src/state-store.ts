import { DataAdapter } from 'obsidian'

export interface FileState {
  localMd5: string
  localMtime: number
  localSize: number
  remoteEtag: string
  syncedAt: number
}

export class StateStore {
  private data: Record<string, FileState> = {}
  private dirty = false

  constructor(
    private adapter: DataAdapter,
    private path: string
  ) {}

  async load(): Promise<void> {
    try {
      if (await this.adapter.exists(this.path)) {
        const raw = await this.adapter.read(this.path)
        this.data = JSON.parse(raw || '{}')
      }
    } catch (e) {
      console.error('[COS Sync] failed to load state', e)
      this.data = {}
    }
    this.dirty = false
  }

  async save(): Promise<void> {
    if (!this.dirty) return
    try {
      await this.adapter.write(this.path, JSON.stringify(this.data, null, 2))
      this.dirty = false
    } catch (e) {
      console.error('[COS Sync] failed to save state', e)
    }
  }

  get(path: string): FileState | undefined {
    return this.data[path]
  }

  set(path: string, state: FileState): void {
    const prev = this.data[path]
    if (
      prev &&
      prev.localMd5 === state.localMd5 &&
      prev.localMtime === state.localMtime &&
      prev.localSize === state.localSize &&
      prev.remoteEtag === state.remoteEtag
    ) {
      return
    }
    this.data[path] = state
    this.dirty = true
  }

  remove(path: string): void {
    if (path in this.data) {
      delete this.data[path]
      this.dirty = true
    }
  }

  keys(): string[] {
    return Object.keys(this.data)
  }
}
