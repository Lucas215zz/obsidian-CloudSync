import { App, PluginSettingTab, Setting } from 'obsidian'
import type CosSyncPlugin from './main'

export type ConflictStrategy =
  | 'keepBothLocalWins'
  | 'keepBothRemoteWins'
  | 'localWins'
  | 'remoteWins'
  | 'skip'

export interface SyncSettings {
  secretId: string
  secretKey: string
  bucket: string
  region: string
  prefix: string
  enableAutoSync: boolean
  syncIntervalMinutes: number
  enableRealtimeWatch: boolean
  notifyOnSync: boolean
  conflictStrategy: ConflictStrategy
  syncDotObsidian: boolean
  trashDeletedFiles: boolean
  extraExclude: string[]
}

export const DEFAULT_SETTINGS: SyncSettings = {
  secretId: '',
  secretKey: '',
  bucket: '',
  region: 'ap-guangzhou',
  prefix: 'obsidian/',
  enableAutoSync: true,
  syncIntervalMinutes: 5,
  enableRealtimeWatch: true,
  notifyOnSync: true,
  conflictStrategy: 'keepBothLocalWins',
  syncDotObsidian: false,
  trashDeletedFiles: true,
  extraExclude: [],
}

export class SyncSettingTab extends PluginSettingTab {
  plugin: CosSyncPlugin

  constructor(app: App, plugin: CosSyncPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl('h2', { text: 'Tencent COS Sync' })

    new Setting(containerEl)
      .setName('SecretId')
      .setDesc('腾讯云 API 密钥 SecretId（建议使用子账号最小权限密钥）')
      .addText((t) =>
        t
          .setPlaceholder('AKID...')
          .setValue(this.plugin.settings.secretId)
          .onChange(async (v) => {
            this.plugin.settings.secretId = v.trim()
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('SecretKey')
      .setDesc('腾讯云 API 密钥 SecretKey，仅保存在本机')
      .addText((t) => {
        t.inputEl.type = 'password'
        t.setPlaceholder('******')
          .setValue(this.plugin.settings.secretKey)
          .onChange(async (v) => {
            this.plugin.settings.secretKey = v.trim()
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName('Bucket')
      .setDesc('COS 存储桶名称，形如 mybucket-1250000000')
      .addText((t) =>
        t
          .setPlaceholder('mybucket-1250000000')
          .setValue(this.plugin.settings.bucket)
          .onChange(async (v) => {
            this.plugin.settings.bucket = v.trim()
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Region')
      .setDesc('存储桶所属地域，如 ap-guangzhou / ap-shanghai / ap-nanjing')
      .addText((t) =>
        t
          .setPlaceholder('ap-guangzhou')
          .setValue(this.plugin.settings.region)
          .onChange(async (v) => {
            this.plugin.settings.region = v.trim()
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Prefix')
      .setDesc('文件在桶内的前缀目录，例如 obsidian/ 。不同仓库可用不同前缀隔离')
      .addText((t) =>
        t
          .setPlaceholder('obsidian/')
          .setValue(this.plugin.settings.prefix)
          .onChange(async (v) => {
            this.plugin.settings.prefix = v
            await this.plugin.saveSettings()
          })
      )

    containerEl.createEl('h3', { text: '同步策略' })

    new Setting(containerEl)
      .setName('启用自动同步')
      .setDesc('按固定间隔轮询云端，拉取其他设备的改动')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableAutoSync).onChange(async (v) => {
          this.plugin.settings.enableAutoSync = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('同步间隔（分钟）')
      .setDesc('自动同步的轮询间隔，默认 5 分钟')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (v) => {
            const n = parseInt(v, 10)
            this.plugin.settings.syncIntervalMinutes = isNaN(n) || n < 1 ? 5 : n
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('启用实时监听')
      .setDesc('本地文件创建/修改/删除后立即触发同步（2 秒防抖）')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableRealtimeWatch).onChange(async (v) => {
          this.plugin.settings.enableRealtimeWatch = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('同步提示')
      .setDesc('实时/自动同步开始与完成时弹出提示，方便确认是否在实时同步')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.notifyOnSync).onChange(async (v) => {
          this.plugin.settings.notifyOnSync = v
          await this.plugin.saveSettings()
        })
      )

    containerEl.createEl('h3', { text: '冲突与安全' })

    new Setting(containerEl)
      .setName('冲突处理策略')
      .setDesc('当本地和云端同时修改同一文件时的处理方式。默认「双方都保留」最安全，不丢数据')
      .addDropdown((d) =>
        d
          .addOption('keepBothLocalWins', '双方都保留（本地为准）')
          .addOption('keepBothRemoteWins', '双方都保留（云端为准）')
          .addOption('localWins', '本地覆盖云端')
          .addOption('remoteWins', '云端覆盖本地')
          .addOption('skip', '跳过（仅记录）')
          .setValue(this.plugin.settings.conflictStrategy)
          .onChange(async (v) => {
            this.plugin.settings.conflictStrategy = v as ConflictStrategy
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('删除时移入回收站')
      .setDesc('同步导致的本地文件删除会先移入 Obsidian 回收站（.trash），可恢复')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.trashDeletedFiles).onChange(async (v) => {
          this.plugin.settings.trashDeletedFiles = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('同步 .obsidian 配置')
      .setDesc('默认不同步 .obsidian（各设备插件配置独立）。开启后同步但排除 workspace 与本插件状态文件')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncDotObsidian).onChange(async (v) => {
          this.plugin.settings.syncDotObsidian = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('额外排除规则')
      .setDesc('每行一条。支持通配符，如 *.png 、folder/ 、private/*')
      .addTextArea((t) =>
        t
          .setPlaceholder('*.png\nfolder/')
          .setValue(this.plugin.settings.extraExclude.join('\n'))
          .onChange(async (v) => {
            this.plugin.settings.extraExclude = v
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
            await this.plugin.saveSettings()
          })
      )
  }
}
