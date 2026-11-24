// 同步范围判定的离线自测（node 运行，不连 COS）
import { isExcludedPath, isPathInSyncScope, normFolder } from '../src/utils'

// 与 DEFAULT_SETTINGS 保持一致（不 import settings.ts，避免拉进 obsidian 运行时）
const BASE = {
  syncDotObsidian: true,
  trashDeletedFiles: true,
  extraExclude: [] as string[],
  syncScopeMode: 'all' as 'all' | 'onlySelected',
  scopeFolders: [] as string[],
  syncRootFiles: true,
}

let failed = 0
function ok(name: string, actual: boolean, expected: boolean): void {
  if (actual !== expected) {
    failed++
    console.error(`FAIL ${name}: got ${actual}, want ${expected}`)
  } else {
    console.log(`PASS ${name}`)
  }
}

function cfg(patch: Record<string, unknown>): any {
  return Object.assign({}, BASE, patch)
}

// normFolder
ok('normFolder 去首尾斜杠', normFolder('/A/B/') === 'A/B', true)
ok('normFolder 反斜杠', normFolder('A\\B') === 'A/B', true)

// 1. 默认 all 模式，什么都没勾：全部同步
const s0 = cfg({})
ok('all/空列表 普通文件在范围', isPathInSyncScope('工作台/首页.md', s0), true)
ok('all/空列表 .obsidian 在范围', isPathInSyncScope('.obsidian/app.json', s0), true)

// 2. all 模式勾选排除
const s1 = cfg({ scopeFolders: ['所有笔记/0A_AI方向'] })
ok('all 排除 目标文件夹本身', isPathInSyncScope('所有笔记/0A_AI方向', s1), false)
ok('all 排除 子文件', isPathInSyncScope('所有笔记/0A_AI方向/笔记.md', s1), false)
ok('all 排除 深层子文件', isPathInSyncScope('所有笔记/0A_AI方向/a/b/c.md', s1), false)
ok('all 排除 兄弟文件夹不受影响', isPathInSyncScope('所有笔记/0H_认知提升/x.md', s1), true)
ok('all 排除 前缀相近不算命中', isPathInSyncScope('所有笔记/0A_AI方向2/x.md', s1), true)
ok('all 排除 根目录文件不受影响', isPathInSyncScope('README.md', s1), true)
ok('all 排除 .obsidian 不受影响', isPathInSyncScope('.obsidian/app.json', s1), true)
ok('all 排除 带尾斜杠路径', isPathInSyncScope('所有笔记/0A_AI方向/', s1), false)
ok('all 排除 反斜杠路径', isPathInSyncScope('所有笔记\\0A_AI方向\\a.md', s1), false)

// 3. onlySelected 白名单
const s2 = cfg({ syncScopeMode: 'onlySelected', scopeFolders: ['所有笔记'] })
ok('only 白名单内', isPathInSyncScope('所有笔记/00_个人成长/x.md', s2), true)
ok('only 白名单外', isPathInSyncScope('工作台/首页.md', s2), false)
ok('only 根目录文件默认同步', isPathInSyncScope('README.md', s2), true)
ok('only .obsidian 不受范围影响', isPathInSyncScope('.obsidian/app.json', s2), true)

const s3 = cfg({ syncScopeMode: 'onlySelected', scopeFolders: ['所有笔记'], syncRootFiles: false })
ok('only 根目录文件关掉后不同步', isPathInSyncScope('README.md', s3), false)

const s4 = cfg({ syncScopeMode: 'onlySelected', scopeFolders: [] })
ok('only 未勾选任何文件夹 → 全不同步', isPathInSyncScope('所有笔记/x.md', s4), false)

// 4. isExcludedPath 集成：范围检查与原有规则共存
const s5 = cfg({ scopeFolders: ['Clippings'], extraExclude: ['*.mp4'] })
ok('范围外 → 被排除', isExcludedPath('Clippings/网页.md', s5), true)
ok('范围内 → 不被排除', isExcludedPath('工作台/首页.md', s5), false)
ok('原有通配符排除仍生效', isExcludedPath('工作台/demo.mp4', s5), true)
ok('回收站仍排除', isExcludedPath('.trash/x.md', s5), true)
ok('.obsidian 内的插件自身目录仍排除', isExcludedPath('.obsidian/plugins/obsidian-cos-sync/data.json', s5), true)
ok('.obsidian 关闭同步时排除', isExcludedPath('.obsidian/app.json', cfg({ syncDotObsidian: false })), true)
ok('.obsidian 打开同步时放行', isExcludedPath('.obsidian/app.json', cfg({ syncDotObsidian: true })), false)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\nALL SCOPE CHECKS PASSED')
