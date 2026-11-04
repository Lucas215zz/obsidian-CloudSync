import { createHash } from 'crypto'
import { SyncSettings } from './settings'

export function md5Buffer(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex')
}

export function isMd5Hex(s: string): boolean {
  return /^[0-9a-f]{32}$/i.test(s)
}

export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length)
  const view = new Uint8Array(ab)
  view.set(buf)
  return ab
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

export function isExcludedPath(path: string, settings: SyncSettings): boolean {
  const p = path.replace(/\\/g, '/')
  if (p.startsWith('.trash/')) return true
  if (p.startsWith('.git/')) return true
  if (p.startsWith('.obsidian/')) {
    if (!settings.syncDotObsidian) return true
    if (p.startsWith('.obsidian/workspace')) return true
    if (p.includes('sync-state.json')) return true
  }
  const name = splitPath(p).name
  if (name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name === '.git') return true
  if (name.endsWith('.tmp') || name.endsWith('.bak') || name.endsWith('.swp')) return true
  for (const pat of settings.extraExclude || []) {
    if (matchesGlob(p, pat)) return true
  }
  return false
}
