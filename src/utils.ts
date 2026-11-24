import { md5 } from 'js-md5'
import type { SyncSettings } from './settings'

export function md5Of(buf: ArrayBuffer | Uint8Array): string {
  return md5(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
}

export function isMd5Hex(s: string): boolean {
  return /^[0-9a-f]{32}$/i.test(s)
}

export function normalizePrefix(prefix: string): string {
  let p = (prefix || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (p && !p.endsWith('/')) p += '/'
  return p
}

export function stripQuotes(s: string): string {
  return (s || '').replace(/^"|"$/g, '')
}

export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/')
  if (i < 0) return { dir: '', name: p }
  return { dir: p.slice(0, i), name: p.slice(i + 1) }
}

export function extParts(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.')
  if (i <= 0) return { base: name, ext: '' }
  return { base: name.slice(0, i), ext: name.slice(i) }
}

export function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

export function conflictPathFor(path: string): string {
  const { dir, name } = splitPath(path)
  const { base, ext } = extParts(name)
  const rand = Math.random().toString(36).slice(2, 6)
  const conflictName = `${base} (conflict ${stamp()} ${rand})${ext}`
  return dir ? `${dir}/${conflictName}` : conflictName
}

export function matchesGlob(path: string, pattern: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  if (p.endsWith('/')) return path.startsWith(p)
  let re = ''
  for (const ch of p) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(re).test(path) || path.includes(p)
  } catch {
    return path.includes(p)
  }
}

/** 统一成不带首尾斜杠的 POSIX 相对路径 */
export function normFolder(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/** path 是否就是 folder 本身，或位于其子树内 */
export function folderContains(folder: string, path: string): boolean {
  const f = normFolder(folder)
  if (!f) return false
  return path === f || path.startsWith(f + '/')
}

/**
 * 是否在用户设定的同步范围内。
 * - all：勾选的文件夹不参与同步，其余照常；
 * - onlySelected：只有勾选的文件夹参与同步；
 * .obsidian 由 syncDotObsidian 开关单独控制，不受此范围影响。
 */
export function isPathInSyncScope(path: string, settings: SyncSettings): boolean {
  const p = normFolder(path)
  if (!p) return true
  if (p === '.obsidian' || p.startsWith('.obsidian/')) return true

  const folders = (settings.scopeFolders || []).map(normFolder).filter(Boolean)
  if ((settings.syncScopeMode || 'all') === 'onlySelected') {
    // 根目录散落文件由 syncRootFiles 单独决定
    if (!p.includes('/')) return settings.syncRootFiles !== false
    return folders.some((f) => folderContains(f, p))
  }
  return !folders.some((f) => folderContains(f, p))
}

export function isExcludedPath(path: string, settings: SyncSettings): boolean {
  const p = path.replace(/\\/g, '/')

  // 根级隐藏目录：回收站、Git
  if (p.startsWith('.trash/')) return true
  if (p.startsWith('.git/')) return true

  // .obsidian 目录：由 syncDotObsidian 开关控制；内部临时状态与本插件自身目录永远排除
  if (p.startsWith('.obsidian/')) {
    if (!settings.syncDotObsidian) return true
    if (p.startsWith('.obsidian/workspace')) return true // workspace.json / workspaces.json 会话状态
    if (p.includes('sync-state.json')) return true // 本插件同步状态文件
    // 本插件自身目录不同步：data.json 含 SecretKey 等密钥，main.js 为编译产物无需跨设备同步
    if (p.startsWith('.obsidian/plugins/obsidian-cos-sync/')) return true
  }

  // 路径任意层级命中「系统垃圾 / 缓存」名称 → 排除（借鉴 remotely-save）
  const segments = p.split('/')
  const junkNames = new Set([
    '.git', '.github', '.gitlab', '.svn', 'node_modules',
    '.DS_Store', '__MACOSX', 'Icon',
    'desktop.ini', 'Desktop.ini', 'thumbs.db', 'Thumbs.db',
  ])
  for (const seg of segments) {
    if (junkNames.has(seg)) return true
  }

  const name = segments[segments.length - 1]
  // Office 临时锁文件 ~$xxx.docx
  if (name.startsWith('~$')) {
    const ext = (name.split('.').pop() || '').toLowerCase()
    if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return true
  }
  // 常见临时 / 备份文件
  if (name.endsWith('.tmp') || name.endsWith('.bak') || name.endsWith('.swp')) return true

  // 用户设定的同步范围（文件夹勾选）：范围外的一律不参与同步
  if (!isPathInSyncScope(p, settings)) return true

  // 用户自定义排除（每行一条，支持通配符）
  for (const pat of settings.extraExclude || []) {
    if (matchesGlob(p, pat)) return true
  }
  return false
}
