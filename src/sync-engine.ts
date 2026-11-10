import { Vault } from 'obsidian'
import { CosClient } from './cos-client'
import { StateStore } from './state-store'
import { SyncSettings } from './settings'
import {
  normalizePrefix,
  isExcludedPath,
  md5Of,
  isMd5Hex,
  splitPath,
  conflictPathFor,
} from './utils'

export interface SyncResult {
  uploaded: number
  downloaded: number
  deletedRemote: number
  deletedLocal: number
  conflicts: number
  skipped: number
}

type Op =
  | { type: 'upload'; path: string }
  | { type: 'download'; path: string }
  | { type: 'deleteRemote'; path: string }
  | { type: 'deleteLocal'; path: string }
  | { type: 'conflict'; path: string }

function emptyResult(): SyncResult {
  return { uploaded: 0, downloaded: 0, deletedRemote: 0, deletedLocal: 0, conflicts: 0, skipped: 0 }
}

export class SyncEngine {
  private runPromise: Promise<SyncResult> | null = null
  private pending = false

  constructor(
    private vault: Vault,
    private client: CosClient,
    private state: StateStore,
    private getSettings: () => SyncSettings,
    private log: (msg: string) => void = () => {}
  ) {}

  get isRunning(): boolean {
    return this.runPromise !== null
  }

  sync(): Promise<SyncResult> {
    if (this.runPromise) return this.runPromise
    this.runPromise = this.run().finally(() => {
      this.runPromise = null
    })
    return this.runPromise
  }

  requestSync(): Promise<SyncResult> {
    this.pending = true
    return this.sync()
  }

  private async run(): Promise<SyncResult> {
    const total = emptyResult()
    do {
      this.pending = false
      const r = await this.doSync()
      total.uploaded += r.uploaded
      total.downloaded += r.downloaded
      total.deletedRemote += r.deletedRemote
      total.deletedLocal += r.deletedLocal
      total.conflicts += r.conflicts
      total.skipped += r.skipped
    } while (this.pending)
    return total
  }

  private async doSync(): Promise<SyncResult> {
    const settings = this.getSettings()
    const prefix = normalizePrefix(settings.prefix)
    const result = emptyResult()

    // 1. Local files
    const localMap = new Map<string, { mtime: number; size: number }>()
    for (const f of this.vault.getFiles()) {
      if (isExcludedPath(f.path, settings)) continue
      localMap.set(f.path, { mtime: f.stat.mtime, size: f.stat.size })
    }
    // Vault API 不返回隐藏文件夹（如 .obsidian）里的文件，需用底层 adapter 手动遍历，
    // 这样 syncDotObsidian 开关才能真正生效（借鉴 remotely-save 的做法）。
    if (settings.syncDotObsidian) {
      await this.walkHiddenDir('.obsidian', localMap, settings)
    }

    // 2. Remote objects
    const remoteMap = new Map<string, string>()
    const remoteList = await this.client.listAll(prefix)
    for (const o of remoteList) {
      const rel = o.key.startsWith(prefix) ? o.key.slice(prefix.length) : o.key
      if (!rel) continue
      remoteMap.set(rel, o.etag)
    }

    // 3. Three-way diff
    const keys = new Set<string>()
    localMap.forEach((_, k) => keys.add(k))
    remoteMap.forEach((_, k) => keys.add(k))
    this.state.keys().forEach((k) => keys.add(k))

    const localMd5Cache = new Map<string, string>()
    const remoteMd5Cache = new Map<string, string>()
    const ops: Op[] = []

    for (const path of keys) {
      const local = localMap.get(path)
      const remoteEtag = remoteMap.get(path)
      const prev = this.state.get(path)
      const localExists = !!local
      const remoteExists = remoteEtag !== undefined

      let localMd5: string | undefined
      if (localExists) {
        localMd5 = await this.getLocalMd5(path, localMd5Cache)
      }

      const localChanged = localExists
        ? prev
          ? localMd5 !== prev.localMd5
          : true
        : prev
          ? true
          : false
      const remoteChanged = remoteExists
        ? prev
          ? remoteEtag !== prev.remoteEtag
          : true
        : prev
          ? true
          : false

      if (localExists && remoteExists) {
        if (!prev) {
          // 首次遇到（无历史基线）：先按内容判断是否已经一致，避免把相同文件全量重传。
          const same = await this.contentEquals(
            path,
            prefix,
            localMd5!,
            remoteEtag!,
            remoteMd5Cache
          )
          if (same) {
            this.state.set(path, {
              localMd5: localMd5!,
              localMtime: local!.mtime,
              localSize: local!.size,
              remoteEtag: remoteEtag!,
              syncedAt: Date.now(),
            })
            result.skipped++
          } else {
            // 两端都存在但内容不同：没有基线，按冲突处理（由策略决定保留哪边）。
            ops.push({ type: 'conflict', path })
          }
        } else if (!localChanged && !remoteChanged) {
          result.skipped++
        } else if (localChanged && !remoteChanged) {
          ops.push({ type: 'upload', path })
        } else if (!localChanged && remoteChanged) {
          ops.push({ type: 'download', path })
        } else {
          ops.push({ type: 'conflict', path })
        }
      } else if (localExists && !remoteExists) {
        if (prev && prev.remoteEtag) {
          if (localChanged) ops.push({ type: 'upload', path })
          else ops.push({ type: 'deleteLocal', path })
        } else {
          ops.push({ type: 'upload', path })
        }
      } else if (!localExists && remoteExists) {
        if (prev && prev.localMd5) {
          if (remoteChanged) ops.push({ type: 'download', path })
          else ops.push({ type: 'deleteRemote', path })
        } else {
          ops.push({ type: 'download', path })
        }
      } else {
        this.state.remove(path)
      }
    }

    // 4. Execute
    for (const op of ops) {
      switch (op.type) {
        case 'upload': {
          const buf = await this.vault.adapter.readBinary(op.path)
          const md5 = md5Of(buf)
          const { etag } = await this.client.put(prefix + op.path, buf)
          const l = localMap.get(op.path)!
          this.state.set(op.path, {
            localMd5: md5,
            localMtime: l.mtime,
            localSize: l.size,
            remoteEtag: etag,
            syncedAt: Date.now(),
          })
          result.uploaded++
          break
        }
        case 'download': {
          const buf = await this.client.get(prefix + op.path)
          await this.ensureParentDirs(op.path)
          await this.writeBinary(op.path, buf)
          const md5 = md5Of(buf)
          const st = await this.vault.adapter.stat(op.path)
          this.state.set(op.path, {
            localMd5: md5,
            localMtime: st?.mtime ?? Date.now(),
            localSize: st?.size ?? buf.byteLength,
            remoteEtag: remoteMap.get(op.path) || '',
            syncedAt: Date.now(),
          })
          result.downloaded++
          break
        }
        case 'deleteRemote': {
          await this.client.remove(prefix + op.path)
          this.state.remove(op.path)
          result.deletedRemote++
          break
        }
        case 'deleteLocal': {
          await this.trashOrRemove(op.path, settings)
          this.state.remove(op.path)
          result.deletedLocal++
          break
        }
        case 'conflict': {
          const r = await this.resolveConflict(op.path, prefix, settings, remoteMap, localMd5Cache)
          result.conflicts++
          result.uploaded += r.uploaded
          result.downloaded += r.downloaded
          break
        }
      }
    }

    await this.state.save()
    // 5. 清理因删除而空置的目录（Obsidian 本身也会隐藏空目录）
    await this.pruneEmptyDirectories(settings)
    return result
  }

  /**
   * 递归遍历隐藏目录（如 .obsidian）。Vault.getFiles() 不返回隐藏文件夹里的文件，
   * 所以用底层 adapter 手动列出，再经 isExcludedPath 过滤缓存/垃圾文件。
   */
  private async walkHiddenDir(
    dir: string,
    map: Map<string, { mtime: number; size: number }>,
    settings: SyncSettings
  ): Promise<void> {
    let listed: { files: string[]; folders: string[] }
    try {
      listed = await this.vault.adapter.list(dir)
    } catch {
      return
    }
    // adapter.list() returns paths relative to the vault root (not bare names),
    // so use them as-is; prefixing `dir` again would double it (e.g.
    // ".obsidian/.obsidian/app.json") and break uploads with ENOENT.
    for (const path of listed.files) {
      if (isExcludedPath(path, settings)) continue
      let mtime = 0
      let size = 0
      try {
        const st = await this.vault.adapter.stat(path)
        if (st) {
          mtime = st.mtime ?? 0
          size = st.size ?? 0
        }
      } catch {
        // 文件可能刚被删除，跳过即可
      }
      map.set(path, { mtime, size })
    }
    for (const folder of listed.folders) {
      await this.walkHiddenDir(folder, map, settings)
    }
  }

  /**
   * 删除所有「空目录」。目录不是一级同步实体，只作为文件路径的载体存在；
   * 当目录里的文件被删除后，空目录应当被一并回收，否则会残留在本地。
   * 按深度从深到浅删除，保证父目录在子目录清空后也能被回收。
   */
  private async pruneEmptyDirectories(settings: SyncSettings): Promise<void> {
    const folders = this.vault
      .getAllFolders()
      .filter((f) => !f.isRoot() && !!f.path && f.path !== '/')
      .filter((f) => !isExcludedPath(f.path + '/', settings))

    folders.sort((a, b) => {
      const da = a.path.split('/').length
      const db = b.path.split('/').length
      return db - da
    })

    for (const folder of folders) {
      try {
        const listed = await this.vault.adapter.list(folder.path)
        if (listed.files.length === 0 && listed.folders.length === 0) {
          await this.vault.adapter.rmdir(folder.path, false)
          this.log(`pruned empty directory: ${folder.path}`)
        }
      } catch (e) {
        this.log(`prune empty directory failed (${folder.path}): ${(e as Error)?.message || e}`)
      }
    }
  }

  /**
   * 判断本地文件内容与远端对象内容是否一致。
   * 优先使用 COS 的 ETag：简单上传时 ETag 就是内容 MD5，可直接与本地 MD5 对比；
   * 若不是 32 位 MD5（如分片上传），则下载远端内容计算 MD5 精确对比。
   */
  private async contentEquals(
    path: string,
    prefix: string,
    localMd5: string,
    remoteEtag: string,
    remoteMd5Cache: Map<string, string>
  ): Promise<boolean> {
    if (isMd5Hex(remoteEtag)) {
      return remoteEtag.toLowerCase() === localMd5.toLowerCase()
    }
    let remoteMd5 = remoteMd5Cache.get(path)
    if (!remoteMd5) {
      const buf = await this.client.get(prefix + path)
      remoteMd5 = md5Of(buf)
      remoteMd5Cache.set(path, remoteMd5)
    }
    return remoteMd5 === localMd5
  }

  private async getLocalMd5(path: string, cache: Map<string, string>): Promise<string> {
    if (cache.has(path)) return cache.get(path)!
    const buf = await this.vault.adapter.readBinary(path)
    const md5 = md5Of(buf)
    cache.set(path, md5)
    return md5
  }

  private async resolveConflict(
    path: string,
    prefix: string,
    settings: SyncSettings,
    remoteMap: Map<string, string>,
    localMd5Cache: Map<string, string>
  ): Promise<{ uploaded: number; downloaded: number }> {
    const strategy = settings.conflictStrategy
    const remoteEtag = remoteMap.get(path) || ''
    const localBuf = await this.vault.adapter.readBinary(path)
    const localMd5 = md5Of(localBuf)
    localMd5Cache.set(path, localMd5)
    const localStat = await this.vault.adapter.stat(path)

    switch (strategy) {
      case 'localWins': {
        const { etag } = await this.client.put(prefix + path, localBuf)
        this.state.set(path, {
          localMd5,
          localMtime: localStat?.mtime ?? Date.now(),
          localSize: localStat?.size ?? localBuf.byteLength,
          remoteEtag: etag,
          syncedAt: Date.now(),
        })
        return { uploaded: 1, downloaded: 0 }
      }
      case 'remoteWins': {
        const remoteBuf = await this.client.get(prefix + path)
        if (settings.trashDeletedFiles) await this.trashOrRemove(path, settings)
        await this.writeBinary(path, remoteBuf)
        const md5 = md5Of(remoteBuf)
        const st = await this.vault.adapter.stat(path)
        this.state.set(path, {
          localMd5: md5,
          localMtime: st?.mtime ?? Date.now(),
          localSize: st?.size ?? remoteBuf.byteLength,
          remoteEtag,
          syncedAt: Date.now(),
        })
        return { uploaded: 0, downloaded: 1 }
      }
      case 'keepBothLocalWins': {
        const remoteBuf = await this.client.get(prefix + path)
        const conflictPath = conflictPathFor(path)
        await this.writeBinary(conflictPath, remoteBuf)
        const { etag } = await this.client.put(prefix + path, localBuf)
        const { etag: conflictEtag } = await this.client.put(prefix + conflictPath, remoteBuf)
        const conflictMd5 = md5Of(remoteBuf)
        const cst = await this.vault.adapter.stat(conflictPath)
        this.state.set(path, {
          localMd5,
          localMtime: localStat?.mtime ?? Date.now(),
          localSize: localStat?.size ?? localBuf.byteLength,
          remoteEtag: etag,
          syncedAt: Date.now(),
        })
        this.state.set(conflictPath, {
          localMd5: conflictMd5,
          localMtime: cst?.mtime ?? Date.now(),
          localSize: cst?.size ?? remoteBuf.byteLength,
          remoteEtag: conflictEtag,
          syncedAt: Date.now(),
        })
        return { uploaded: 2, downloaded: 0 }
      }
      case 'keepBothRemoteWins': {
        const remoteBuf = await this.client.get(prefix + path)
        const conflictPath = conflictPathFor(path)
        await this.writeBinary(conflictPath, localBuf)
        const { etag: conflictEtag } = await this.client.put(prefix + conflictPath, localBuf)
        await this.writeBinary(path, remoteBuf)
        const md5 = md5Of(remoteBuf)
        const st = await this.vault.adapter.stat(path)
        const cst = await this.vault.adapter.stat(conflictPath)
        this.state.set(path, {
          localMd5: md5,
          localMtime: st?.mtime ?? Date.now(),
          localSize: st?.size ?? remoteBuf.byteLength,
          remoteEtag,
          syncedAt: Date.now(),
        })
        this.state.set(conflictPath, {
          localMd5,
          localMtime: cst?.mtime ?? Date.now(),
          localSize: cst?.size ?? localBuf.byteLength,
          remoteEtag: conflictEtag,
          syncedAt: Date.now(),
        })
        return { uploaded: 1, downloaded: 1 }
      }
      case 'skip':
      default: {
        this.state.set(path, {
          localMd5,
          localMtime: localStat?.mtime ?? Date.now(),
          localSize: localStat?.size ?? localBuf.byteLength,
          remoteEtag,
          syncedAt: Date.now(),
        })
        return { uploaded: 0, downloaded: 0 }
      }
    }
  }

  private async writeBinary(path: string, buf: ArrayBuffer): Promise<void> {
    await this.vault.adapter.writeBinary(path, buf)
  }

  private async ensureParentDirs(path: string): Promise<void> {
    const { dir } = splitPath(path)
    if (!dir) return
    const parts = dir.split('/')
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p
      if (!(await this.vault.adapter.exists(acc))) {
        await this.vault.createFolder(acc)
      }
    }
  }

  private async trashOrRemove(path: string, settings: SyncSettings): Promise<void> {
    if (settings.trashDeletedFiles) {
      const file = this.vault.getAbstractFileByPath(path)
      if (file) {
        await this.vault.trash(file, false)
        return
      }
    }
    await this.vault.adapter.remove(path)
  }
}
