import esbuild from 'esbuild'
import process from 'process'

const banner = `/*
Tencent COS Sync for Obsidian
*/
`

const prod = process.argv[2] === 'production'

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  // Browser platform: no Node.js built-ins — the plugin must run on
  // mobile Obsidian (Capacitor) as well as desktop (Electron).
  platform: 'browser',
  format: 'cjs',
  target: 'es2018',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  // js-md5 detects Node via `process.versions.node` and would require crypto/buffer,
  // which esbuild stubs to empty modules under `platform: 'browser'` (its package.json
  // maps `crypto`/`buffer` to false), crashing at load time on desktop. Force the pure-JS path.
  define: { 'process.versions.node': 'undefined' },
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
