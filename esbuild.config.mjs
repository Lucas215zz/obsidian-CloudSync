import esbuild from 'esbuild'
import process from 'process'
import path from 'path'

const banner = `/*
Tencent COS Sync for Obsidian
*/
`

const prod = process.argv[2] === 'production'

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
  'module', 'net', 'os', 'path', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty',
  'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib', 'perf_hooks'
]

// cos-nodejs-sdk-v5 -> tough-cookie 里 require("punycode/")。
// Obsidian 的 Electron 运行时已不再内置 punycode（Node 24 起移除），
// 而 esbuild 无法直接解析带尾斜杠的 "punycode/"，导致产物里残留外部
// require("punycode/")，插件加载时报 MODULE_NOT_FOUND。这里把它解析到
// 本地 node_modules 的 punycode 并打进包里，让插件自包含。
const punycodePlugin = {
  name: 'punycode-slash',
  setup(build) {
    build.onResolve({ filter: /^punycode\/$/ }, () => ({
      path: path.resolve(process.cwd(), 'node_modules/punycode/punycode.js'),
    }))
  },
}

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...nodeBuiltins],
  plugins: [punycodePlugin],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
})

if (prod) {
  await context.rebuild()
  process.exit(0)
} else {
  await context.watch()
}
