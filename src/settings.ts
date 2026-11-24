import { App, PluginSettingTab, Setting, TFolder } from 'obsidian'
import type CosSyncPlugin from './main'
import { normFolder } from './utils'

export type ConflictStrategy =
  | 'keepBothLocalWins'
  | 'keepBothRemoteWins'
  | 'localWins'
  | 'remoteWins'
  | 'skip'

/** all：全库同步，勾选的文件夹不参与；onlySelected：只同步勾选的文件夹 */
export type SyncScopeMode = 'all' | 'onlySelected'

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
  syncScopeMode: SyncScopeMode
  scopeFolders: string[]
  syncRootFiles: boolean
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
  syncDotObsidian: true,
  trashDeletedFiles: true,
  extraExclude: [],
  syncScopeMode: 'all',
  scopeFolders: [],
  syncRootFiles: true,
}

export class SyncSettingTab extends PluginSettingTab {
  plugin: CosSyncPlugin
  /** 文件夹树的展开状态与搜索词，重绘时保留 */
  private scopeExpanded = new Set<string>()
  private scopeQuery = ''

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

    containerEl.createEl('h3', { text: '同步范围' })

    new Setting(containerEl)
      .setName('范围模式')
      .setDesc(
        '「全库同步」下勾选的是不参与同步的文件夹；「仅同步勾选」下勾选的才参与同步。取消同步只是不再上传/下载，云端已有文件与本地文件都保留'
      )
      .addDropdown((d) =>
        d
          .addOption('all', '全库同步（勾选 = 不同步）')
          .addOption('onlySelected', '仅同步勾选的文件夹')
          .setValue(this.plugin.settings.syncScopeMode)
          .onChange(async (v) => {
            this.plugin.settings.syncScopeMode = v as SyncScopeMode
            await this.plugin.saveSettings()
            this.display()
          })
      )

    this.renderFolderScope(containerEl)

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
      .setDesc('开启后同步整个仓库，包括 .obsidian 目录下的插件、主题、外观、快捷键、代码片段等。自动排除 workspace 临时状态、本插件自身目录（含密钥的 data.json）与同步状态文件')
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

  /** 仓库里的全部文件夹（不含根），按路径排序 */
  private folderList(): string[] {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => normFolder(f.path))
      .filter((p) => !!p && p !== '/')
      .sort((a, b) => a.localeCompare(b, 'zh'))
  }

  private isFolderChecked(path: string): boolean {
    return (this.plugin.settings.scopeFolders || []).includes(path)
  }

  private async setScopeFolders(list: string[]): Promise<void> {
    this.plugin.settings.scopeFolders = Array.from(
      new Set(list.map(normFolder).filter((p) => !!p && p !== '/'))
    ).sort()
    await this.plugin.saveSettings()
    this.display()
  }

  /** 文件夹树：父子关系、根列表、各文件夹的文件数（含子文件夹） */
  private buildFolderTree(): {
    folders: string[]
    children: Map<string, string[]>
    roots: string[]
    count: Map<string, number>
    rootFileCount: number
  } {
    const folders = this.folderList()
    const folderSet = new Set(folders)
    const children = new Map<string, string[]>()
    const roots: string[] = []
    for (const p of folders) {
      const i = p.lastIndexOf('/')
      if (i < 0 || !folderSet.has(p.slice(0, i))) {
        roots.push(p)
      } else {
        const parent = p.slice(0, i)
        const arr = children.get(parent) ?? []
        arr.push(p)
        children.set(parent, arr)
      }
    }

    const agg = new Map<string, number>()
    let rootFileCount = 0
    for (const f of this.app.vault.getFiles()) {
      const i = f.path.lastIndexOf('/')
      if (i < 0) {
        rootFileCount++
        continue
      }
      const dir = f.path.slice(0, i)
      agg.set(dir, (agg.get(dir) ?? 0) + 1)
    }
    // 由深到浅把子文件夹的文件数累加到父级
    const count = new Map<string, number>()
    const deepestFirst = folders.slice().sort((a, b) => b.split('/').length - a.split('/').length)
    for (const p of deepestFirst) {
      const v = agg.get(p) ?? 0
      count.set(p, v)
      const i = p.lastIndexOf('/')
      if (i >= 0) {
        const parent = p.slice(0, i)
        agg.set(parent, (agg.get(parent) ?? 0) + v)
      }
    }
    return { folders, children, roots, count, rootFileCount }
  }

  private descendantsOf(path: string, folders: string[]): string[] {
    return folders.filter((f) => f.startsWith(path + '/'))
  }

  private renderFolderScope(containerEl: HTMLElement): void {
    const onlySelected = this.plugin.settings.syncScopeMode === 'onlySelected'
    const { folders, children, roots, count, rootFileCount } = this.buildFolderTree()

    containerEl.createDiv({
      cls: 'cos-sync-scope-hint',
      text: onlySelected
        ? '只同步勾选的文件夹（含其子文件夹）；点三角展开，点名字也能展开。'
        : '勾选的文件夹不参与同步（含其子文件夹），其余照常同步；点三角展开，点名字也能展开。',
    })

    const summaryEl = containerEl.createDiv({ cls: 'cos-sync-scope-summary' })

    const toolbar = containerEl.createDiv({ cls: 'cos-sync-scope-toolbar' })
    const search = toolbar.createEl('input', {
      cls: 'cos-sync-scope-search',
      type: 'search',
      placeholder: '搜索文件夹…',
    })
    search.value = this.scopeQuery

    const addBtn = (label: string, onClick: () => void): void => {
      const b = toolbar.createEl('button', { cls: 'cos-sync-scope-btn', text: label })
      b.onclick = onClick
    }
    addBtn('展开', () => {
      for (const p of folders) this.scopeExpanded.add(p)
      draw()
    })
    addBtn('折叠', () => {
      this.scopeExpanded.clear()
      this.scopeQuery = ''
      search.value = ''
      draw()
    })
    addBtn('全选', () => void this.setScopeFolders(folders))
    addBtn('全不选', () => void this.setScopeFolders([]))
    addBtn('反选', () => void this.setScopeFolders(folders.filter((f) => !this.isFolderChecked(f))))

    const box = containerEl.createDiv({ cls: 'cos-sync-folder-scope' })

    const updateSummary = (): void => {
      const selected = new Set(this.plugin.settings.scopeFolders || [])
      const hasSelectedAncestor = (p: string): boolean => {
        let i = p.lastIndexOf('/')
        while (i >= 0) {
          const parent = p.slice(0, i)
          if (selected.has(parent)) return true
          i = parent.lastIndexOf('/')
        }
        return false
      }
      // 只统计最上层被勾选的文件夹，避免父子重复计数
      const topMost = folders.filter((p) => selected.has(p) && !hasSelectedAncestor(p))
      const files = topMost.reduce((n, p) => n + (count.get(p) ?? 0), 0)
      summaryEl.setText(
        onlySelected
          ? `已勾选 ${topMost.length} 个文件夹，约 ${files} 个文件参与同步` +
              (this.plugin.settings.syncRootFiles ? `；根目录另有 ${rootFileCount} 个文件参与` : '')
          : topMost.length === 0
            ? '当前全库同步，没有排除任何文件夹'
            : `已勾选 ${topMost.length} 个文件夹，约 ${files} 个文件不参与同步`
      )
    }

    const draw = (): void => {
      const scrollTop = box.scrollTop
      box.empty()
      const selected = new Set(this.plugin.settings.scopeFolders || [])
      const q = this.scopeQuery.trim().toLowerCase()
      const matches = (p: string): boolean => p.toLowerCase().includes(q)
      const hasMatchingDescendant = (p: string): boolean =>
        (children.get(p) ?? []).some((k) => matches(k) || hasMatchingDescendant(k))
      const isOpen = (p: string): boolean =>
        q ? hasMatchingDescendant(p) : this.scopeExpanded.has(p)

      let shown = 0
      const createRow = (p: string, depth: number): void => {
        shown++
        const kids = children.get(p) ?? []
        const open = isOpen(p)
        const row = box.createDiv({ cls: 'cos-sync-tree-row' })
        row.style.paddingLeft = `${depth * 14}px`

        const toggleOpen = (): void => {
          if (this.scopeExpanded.has(p)) this.scopeExpanded.delete(p)
          else this.scopeExpanded.add(p)
          this.scopeQuery = ''
          search.value = ''
          draw()
        }

        if (kids.length > 0) {
          const twisty = row.createEl('button', {
            cls: 'clickable-icon cos-sync-twisty',
            text: open ? '▾' : '▸',
          })
          twisty.setAttr('aria-label', open ? '折叠' : '展开')
          twisty.onclick = (e) => {
            e.preventDefault()
            toggleOpen()
          }
        } else {
          row.createDiv({ cls: 'cos-sync-twisty is-empty' })
        }

        // 勾选状态：父文件夹带上全部子孙一起算，部分勾选显示为半选
        const subtree = [p, ...this.descendantsOf(p, folders)]
        const checkedCount = subtree.filter((x) => selected.has(x)).length
        const cb = row.createEl('input', { type: 'checkbox', cls: 'cos-sync-tree-check' })
        cb.checked = checkedCount === subtree.length
        cb.indeterminate = checkedCount > 0 && checkedCount < subtree.length
        cb.onchange = () => {
          const next = new Set(selected)
          for (const x of subtree) {
            if (cb.checked) next.add(x)
            else next.delete(x)
          }
          this.plugin.settings.scopeFolders = Array.from(next).sort()
          void this.plugin.saveSettings().then(() => {
            draw()
            updateSummary()
          })
        }

        const name = row.createDiv({ cls: 'cos-sync-tree-name', text: p.split('/').pop() || p })
        name.setAttr('title', p)
        if (kids.length > 0) name.onclick = toggleOpen

        row.createDiv({ cls: 'cos-sync-tree-count', text: String(count.get(p) ?? 0) })

        if (open) {
          for (const k of kids) {
            if (q && !(matches(k) || hasMatchingDescendant(k))) continue
            createRow(k, depth + 1)
          }
        }
      }

      for (const p of roots) {
        if (q && !(matches(p) || hasMatchingDescendant(p))) continue
        createRow(p, 0)
      }
      if (shown === 0) {
        box.createDiv({
          cls: 'cos-sync-scope-hint',
          text: roots.length === 0 ? '仓库里还没有文件夹。' : '没有匹配的文件夹。',
        })
      }
      box.scrollTop = scrollTop
    }

    search.oninput = () => {
      this.scopeQuery = search.value
      draw()
    }

    updateSummary()
    draw()

    if (onlySelected) {
      new Setting(containerEl)
        .setName('同步根目录散落文件')
        .setDesc('根目录下、不属于任何文件夹的文件（如入口笔记）是否参与同步')
        .addToggle((t) =>
          t.setValue(this.plugin.settings.syncRootFiles).onChange(async (v) => {
            this.plugin.settings.syncRootFiles = v
            await this.plugin.saveSettings()
            updateSummary()
          })
        )
    }
  }
}
