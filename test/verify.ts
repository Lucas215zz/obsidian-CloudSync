// Temporary verification: run real COS list/put/get/remove via the new
// web-only CosClient. Uploads a uniquely named test object, verifies
// content round-trip and MD5-vs-ETag consistency, then deletes it.
import { readFileSync } from 'fs'
import { DOMParser as LinkedomDOMParser } from 'linkedom'
import { CosClient } from '../src/cos-client'
import { md5Of } from '../src/utils'

// Node lacks DOMParser (Obsidian runtime has it); polyfill for this test only.
;(globalThis as any).DOMParser = LinkedomDOMParser

async function main(): Promise<void> {
  const data = JSON.parse(
    readFileSync('E:/SynologyDrive/obsidian/.obsidian/plugins/obsidian-cos-sync/data.json', 'utf8')
  )
  const client = new CosClient({
    secretId: data.secretId,
    secretKey: data.secretKey,
    bucket: data.bucket,
    region: data.region,
  })
  const prefix = (data.prefix || '') // already normalized in plugin; data.json holds raw value

  // 1. md5 sanity check against known vector "hello"
  const known = md5Of(new TextEncoder().encode('hello'))
  if (known !== '5d41402abc4b2a76b9719d911017c592') {
    throw new Error(`md5 sanity failed: ${known}`)
  }
  console.log('PASS md5 sanity:', known)

  // 2. list (also proves signature works)
  const before = await client.listAll(prefix)
  console.log('PASS listAll, objects:', before.length, before.slice(0, 3).map((o) => o.key))

  // 3. put / get / etag-vs-md5
  const content = new TextEncoder().encode(`cos-sync mobile verify ${Date.now()}`)
  const key = `${prefix}__verify__/${Date.now()}.txt`
  const { etag } = await client.put(key, content.buffer as ArrayBuffer)
  console.log('PASS put, etag:', etag)
  if (etag.toLowerCase() !== md5Of(content)) {
    throw new Error(`etag ${etag} != local md5 ${md5Of(content)}`)
  }
  console.log('PASS etag matches local md5')

  const back = await client.get(key)
  if (new TextDecoder().decode(back) !== new TextDecoder().decode(content)) {
    throw new Error('round-trip content mismatch')
  }
  console.log('PASS get round-trip')

  // 4. delete + confirm
  await client.remove(key)
  const after = await client.listAll(prefix)
  if (after.some((o) => o.key === key)) {
    throw new Error('object still listed after delete')
  }
  console.log('PASS remove + confirm')
  console.log('ALL CHECKS PASSED')
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e)
  process.exit(1)
})
