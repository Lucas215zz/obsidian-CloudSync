import { Plugin, Notice, TAbstractFile } from 'obsidian'
import { CosClient } from './cos-client'
import { StateStore } from './state-store'
import { SyncEngine, SyncResult } from './sync-engine'
import { SyncSettings, DEFAULT_SETTINGS, SyncSettingTab } from './settings'
import { isExcludedPath } from './utils'

export default class CosSyncPlugin extends Plugin {
  settings: SyncSettings = DEFAULT_SETTINGS
  client!: CosClient
  state!: StateStore
  engine!: SyncEngine

  private statusBarEl!: HTMLElement
  private debounceTimer: number | null = null
  private lastSyncAt = 0
  private lastResultText = ''

  async onload(): Promise<void> {
    await this.loadSettings()

    this.state = new StateStore(this.app.vault.adapter, `${this.manifest.dir}/sync-state.json`)
    await this.state.load()

    this.client = new CosClient({
      secretId: this.settings.secretId,
      secretKey: this.settings.secretKey,
      bucket: this.settings.bucket,
      region: this.settings.region,
    })

    this.engine = new SyncEngine(
      this.app.vault,
      this.client,
      this.state,
      () => this.settings,
      (m) => console.log('[COS Sync]', m)
    )

    this.addSettingTab(new SyncSettingTab(this.app, this))

    // 侧栏按钮：点击一次立即手动同步
    this.addRibbonIcon('refresh-cw', 'COS Sync: 立即同步', () => {
      void this.sync(true)
    })

    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => void this.sync(true),
    })
    this.addCommand({
      id: 'sync-status',
      name: 'Show last sync result',
      callback: () => new Notice(this.lastResultText || 'COS Sync: not synced yet'),
    })

    this.statusBarEl = this.addStatusBarItem()
    this.updateStatus('idle', 'COS: idle')

    this.registerEvent(this.app.vault.on('modify', this.onVaultChange))
    this.registerEvent(this.app.vault.on('create', this.onVaultChange))
    this.registerEvent(this.app.vault.on('delete', this.onVaultChange))
    this.registerEvent(this.app.vault.on('rename', this.onVaultChange))

    this.registerInterval(window.setInterval(() => this.maybeAutoSync(), 30000))

    if (this.settings.enableAutoSync) {
      window.setTimeout(() => void this.sync(false), 5000)
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    this.client?.update({
      secretId: this.settings.secretId,
      secretKey: this.settings.secretKey,
      bucket: this.settings.bucket,
      region: this.settings.region,
    })
  }

  private onVaultChange = (file: TAbstractFile): void => {
    if (!this.settings.enableRealtimeWatch) return
    if (isExcludedPath(file.path, this.settings)) return
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null
      void this.syncRealtime()
    }, 2000)
  }

  private maybeAutoSync(): void {
    if (!this.settings.enableAutoSync) return
    const intervalMs = this.settings.syncIntervalMinutes * 60_000
    if (Date.now() - this.lastSyncAt >= intervalMs) {
      void this.sync(this.settings.notifyOnSync)
    }
  }

  private async syncRealtime(): Promise<void> {
    if (!this.isConfigured()) return
    if (this.settings.notifyOnSync) new Notice('检测到文件变化，正在实时同步…')
    await this.sync(this.settings.notifyOnSync)
  }

  private async sync(notify: boolean): Promise<void> {
    if (!this.isConfigured()) {
      this.updateStatus('error', 'COS: not configured')
      if (notify) new Notice('COS Sync: 请先在设置里填写 SecretId / SecretKey / Bucket / Region')
      return
    }
    this.updateStatus('syncing', 'COS: syncing…')
    try {
      const r = await this.engine.sync()
      this.lastSyncAt = Date.now()
      const summary = this.summarize(r)
      this.lastResultText = `COS Sync: ${summary || 'up to date'}`
      this.updateStatus('ok', 'COS: ' + (summary || 'up to date'))
      if (notify) {
        new Notice(
          `同步完成：上传 ${r.uploaded}，下载 ${r.downloaded}` +
            (r.conflicts ? `，冲突 ${r.conflicts}（已保留双方，请手动合并）` : '')
        )
      }
    } catch (e) {
      this.updateStatus('error', 'COS: error')
      this.lastResultText = `COS Sync error: ${(e as Error)?.message || e}`
      if (notify) new Notice('同步失败：' + ((e as Error)?.message || e))
      console.error('[COS Sync] error', e)
    }
  }

  private summarize(r: SyncResult): string {
    const parts = [`↑${r.uploaded}`, `↓${r.downloaded}`]
    if (r.deletedRemote) parts.push(`✕r${r.deletedRemote}`)
    if (r.deletedLocal) parts.push(`✕l${r.deletedLocal}`)
    if (r.conflicts) parts.push(`⚠${r.conflicts}`)
    return parts.join(' ')
  }

  private isConfigured(): boolean {
    return !!(
      this.settings.secretId &&
      this.settings.secretKey &&
      this.settings.bucket &&
      this.settings.region
    )
  }

  private updateStatus(cls: 'idle' | 'syncing' | 'ok' | 'error', text: string): void {
    if (!this.statusBarEl) return
    this.statusBarEl.setText(text)
    this.statusBarEl.removeClasses(['mod-error', 'mod-success'])
    if (cls === 'error') this.statusBarEl.addClass('mod-error')
    else if (cls === 'ok') this.statusBarEl.addClass('mod-success')
  }

  onunload(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
  }
}
