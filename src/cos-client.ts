import { requestUrl, RequestUrlParam } from 'obsidian'
import { stripQuotes } from './utils'

// Pure-web COS XML API client (no Node.js SDK):
// works on both desktop and mobile Obsidian via `requestUrl`.
// Signature algorithm: https://cloud.tencent.com/document/product/436/7778
export interface RemoteObject {
  key: string
  etag: string
  size: number
}

export interface CosOptions {
  secretId: string
  secretKey: string
  bucket: string
  region: string
}

const SIGN_EXPIRE_SECONDS = 600

export class CosClient {
  private bucket: string
  private region: string
  private secretId: string
  private secretKey: string

  constructor(opts: CosOptions) {
    this.bucket = opts.bucket
    this.region = opts.region
    this.secretId = opts.secretId
    this.secretKey = opts.secretKey
  }

  update(opts: CosOptions): void {
    this.bucket = opts.bucket
    this.region = opts.region
    this.secretId = opts.secretId
    this.secretKey = opts.secretKey
  }

  private host(): string {
    return `${this.bucket}.cos.${this.region}.myqcloud.com`
  }

  private async hmacSha1Hex(key: string, message: string): Promise<string> {
    const enc = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(key),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
    return hexOf(new Uint8Array(sig))
  }

  private async sha1Hex(message: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(message))
    return hexOf(new Uint8Array(digest))
  }

  /**
   * COS XML API authorization header.
   * Per the official SDK (cos-js-sdk-v5 `getAuth`):
   * - The pathname in FormatString is the RAW (unencoded) object path; the
   *   server decodes the request URL and verifies against the raw path.
   * - The Host header is signed by default (q-header-list=host).
   */
  private async authorization(method: string, rawPathname: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const keyTime = `${now - 60};${now + SIGN_EXPIRE_SECONDS}`
    const signKey = await this.hmacSha1Hex(this.secretKey, keyTime)
    const host = this.host()
    // FormatString: method\npathname\nparams\nheaders\n (headers: host=...)
    const httpString = `${method.toLowerCase()}\n${rawPathname}\n\nhost=${camSafeUrlEncode(host)}\n`
    const stringToSign = `sha1\n${keyTime}\n${await this.sha1Hex(httpString)}\n`
    const signature = await this.hmacSha1Hex(signKey, stringToSign)
    return (
      `q-sign-algorithm=sha1&q-ak=${this.secretId}&q-sign-time=${keyTime}` +
      `&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`
    )
  }

  private async request(
    method: 'GET' | 'PUT' | 'DELETE',
    pathname: string,
    query?: Record<string, string>,
    body?: ArrayBuffer
  ): Promise<{ status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer; text: string }> {
    // `pathname` here is the RAW path (may contain Chinese etc.); encode it
    // for the request URL only, keep the raw path for the signature.
    const encodedPathname = pathname
      .split('/')
      .map(camSafeUrlEncode)
      .join('/')
    const auth = await this.authorization(method, pathname)
    const search = query
      ? '?' +
        Object.entries(query)
          // Do not double-encode: values are already URL-encoded by callers.
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
      : ''
    const param: RequestUrlParam = {
      method,
      url: `https://${this.host()}${encodedPathname}${search}`,
      headers: { Authorization: auth },
      throw: false,
    }
    if (body !== undefined) param.body = body
    const res = await requestUrl(param)
    if (res.status >= 300) {
      let detail = ''
      try {
        detail = res.text.slice(0, 500)
      } catch {
        detail = ''
      }
      throw new Error(`COS ${method} ${pathname} failed: HTTP ${res.status} ${detail}`)
    }
    return {
      status: res.status,
      headers: res.headers as Record<string, string>,
      arrayBuffer: res.arrayBuffer,
      text: res.text,
    }
  }

  async listAll(prefix: string): Promise<RemoteObject[]> {
    const result: RemoteObject[] = []
    let marker = ''
    for (;;) {
      const query: Record<string, string> = {
        'max-keys': '1000',
        // Keys here are plain query values (not object keys); encode them once.
        prefix: encodeURIComponent(prefix),
      }
      if (marker) query.marker = encodeURIComponent(marker)
      const res = await this.request('GET', '/', query)
      const doc = new DOMParser().parseFromString(res.text, 'text/xml')
      for (const node of Array.from(doc.getElementsByTagName('Contents'))) {
        const key = node.getElementsByTagName('Key')[0]?.textContent || ''
        const etag = stripQuotes(node.getElementsByTagName('ETag')[0]?.textContent || '')
        const size = Number(node.getElementsByTagName('Size')[0]?.textContent || 0)
        if (!key || key.endsWith('/')) continue
        result.push({ key, etag, size })
      }
      const truncated =
        (doc.getElementsByTagName('IsTruncated')[0]?.textContent || 'false').trim() === 'true'
      if (!truncated) break
      const next =
        doc.getElementsByTagName('NextMarker')[0]?.textContent ||
        (result.length ? result[result.length - 1].key : '')
      if (!next || next === marker) break
      marker = next
    }
    return result
  }

  async put(key: string, body: ArrayBuffer): Promise<{ etag: string }> {
    const pathname = objectPathname(key)
    const res = await this.request('PUT', pathname, undefined, body)
    const etag = res.headers['etag'] || res.headers['ETag'] || ''
    return { etag: stripQuotes(etag) }
  }

  async get(key: string): Promise<ArrayBuffer> {
    const res = await this.request('GET', objectPathname(key))
    return res.arrayBuffer
  }

  async remove(key: string): Promise<void> {
    await this.request('DELETE', objectPathname(key))
  }
}

/** Encode an object key as the RAW request path (signature uses the raw path). */
function objectPathname(key: string): string {
  return '/' + key
}

/**
 * The SDK's camSafeUrlEncode: encodeURIComponent plus RFC3986 strict encoding
 * of ! ' ( ) *.
 */
function camSafeUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function hexOf(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
