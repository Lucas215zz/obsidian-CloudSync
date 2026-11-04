import { stripQuotes } from './utils'
import COS from 'cos-nodejs-sdk-v5'

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

  private sdk: any = null
  private sdkConfig: CosOptions | null = null

  private getSdk(): any {
    const cfg: CosOptions = {
      secretId: this.secretId,
      secretKey: this.secretKey,
      bucket: this.bucket,
      region: this.region,
    }
    const changed =
      !this.sdk ||
      !this.sdkConfig ||
      this.sdkConfig.secretId !== cfg.secretId ||
      this.sdkConfig.secretKey !== cfg.secretKey ||
      this.sdkConfig.bucket !== cfg.bucket ||
      this.sdkConfig.region !== cfg.region
    if (changed) {
      this.sdk = new COS({
        SecretId: cfg.secretId,
        SecretKey: cfg.secretKey,
      })
      this.sdkConfig = cfg
    }
    return this.sdk
  }

  async listAll(prefix: string): Promise<RemoteObject[]> {
    const result: RemoteObject[] = []
    let marker = ''
    for (;;) {
      const params: any = {
        Bucket: this.bucket,
        Region: this.region,
        Prefix: prefix,
        MaxKeys: 1000,
      }
      if (marker) params.Marker = marker
      const data = await this.getSdk().getBucket(params)
      const contents: any[] = data?.Contents || []
      for (const obj of contents) {
        const key: string = obj?.Key || ''
        if (!key || key.endsWith('/')) continue
        result.push({ key, etag: stripQuotes(obj?.ETag || ''), size: Number(obj?.Size || 0) })
      }
      if (!data?.IsTruncated || String(data.IsTruncated) !== 'true') break
      marker = data?.NextMarker || (result.length ? result[result.length - 1].key : '')
      if (!marker) break
    }
    return result
  }

  async put(key: string, body: Buffer): Promise<{ etag: string }> {
    const data = await this.getSdk().putObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Body: body,
      ContentLength: body.length,
    })
    return { etag: stripQuotes(data?.ETag || '') }
  }

  async get(key: string): Promise<Buffer> {
    const data = await this.getSdk().getObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
    })
    return Buffer.from(data?.Body || Buffer.alloc(0))
  }

  async remove(key: string): Promise<void> {
    await this.getSdk().deleteObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
    })
  }
}
