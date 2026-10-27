/**
 * desktop/build.mjs — 打一个**免安装的便携目录**，不引 electron-builder。
 *
 * 产物：release/Artmatic-<version>-win32-x64/Artmatic.exe
 *   resources/app/{main.mjs, preload.cjs, host.mjs, package.json, dist/}
 *
 * 为什么不用 electron-builder：这一步只是「让现有 web 产物在桌面壳里真的跑起来」，
 * 需要的是可复现、可 diff 的最小结构。安装包 / 签名 / 自动更新属于发行流程，
 * 等桌面壳通过验收再引。
 *
 * 用法：
 *   pnpm run build && node desktop/build.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const WEB_DIST = path.join(ROOT, 'dist')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
// 版本号进目录名。Windows 上刚跑过的 exe / asar 会被杀毒、索引器或沙箱短暂锁住，
// 复用同一个目录会让「改一行重打一次」直接 EBUSY/EPERM —— 删不掉就换一个带时间戳的，
// 保证这条命令永远能产出一个可运行的目录。
let OUT = path.join(ROOT, 'release', `Artmatic-${VERSION}-win32-x64`)
if (fs.existsSync(OUT)) {
  try {
    fs.rmSync(OUT, { recursive: true, force: true })
  } catch {
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
    OUT = `${OUT}-${stamp}`
    console.warn('! 旧产物被占用，本次输出到', path.basename(OUT))
  }
}
const APP = path.join(OUT, 'resources', 'app')
const EXE = process.platform === 'win32' ? 'Artmatic.exe' : 'Artmatic'

function fail(msg) {
  console.error('✗', msg)
  process.exit(1)
}

if (!fs.existsSync(ELECTRON_DIST)) fail('找不到 node_modules/electron/dist，先跑 pnpm exec install-electron')
if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) fail('找不到 dist/index.html，先跑 pnpm run build')

// Windows 上杀毒/索引器会短暂锁住刚跑过的 exe 与 asar；删不掉就改名让路，
// 下次再清。直接失败会让「改一行重打一次」变成要手动去删目录。
try {
  fs.rmSync(OUT, { recursive: true, force: true })
} catch {
  const trash = path.join(ROOT, 'release', '.trash-' + Date.now())
  fs.renameSync(OUT, trash)
  console.warn('! 旧产物被占用，已改名为', path.basename(trash))
}
fs.mkdirSync(APP, { recursive: true })

// 1. 壳：整份 Electron 运行时（含 libffmpeg / dll / locales）
fs.cpSync(ELECTRON_DIST, OUT, { recursive: true })
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, EXE))

// 2. 裁 locales。这 55 个 .pak 是 **Chromium 自己**的界面文案（DevTools、右键菜单、
//    网络错误页、文件对话框的 Chromium 部分），跟 Artmatic 的 i18n 无关 ——
//    我们的文案全在 dist 的 JS 里。缺哪个语言 Chromium 会回落 en-US。
//    只留中文两版 + 英文，省 ~47 MB。
const KEEP_LOCALES = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])
const localesDir = path.join(OUT, 'locales')
for (const name of fs.readdirSync(localesDir)) {
  if (!KEEP_LOCALES.has(name)) fs.rmSync(path.join(localesDir, name))
}

// 3. 应用：入口 + 清单 + 产物
for (const f of ['main.mjs', 'preload.cjs', 'host.mjs']) {
  fs.copyFileSync(path.join(__dirname, f), path.join(APP, f))
}
// 容量探测：`host.mjs` 的 `artmatic:capacity` 要 import 它（dev 走 `../scripts`）。
fs.mkdirSync(path.join(APP, 'scripts'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'scripts', 'capacity.mjs'), path.join(APP, 'scripts', 'capacity.mjs'))
fs.cpSync(WEB_DIST, path.join(APP, 'dist'), { recursive: true })
// 许可与第三方归属随发行目录一起走（Apache-2.0 §4(a) 要求随分发附带许可副本）。
for (const f of ['LICENSE', 'CREDITS.md']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(APP, f))
}
fs.writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify(
    { name: 'artmatic', productName: 'Artmatic', version: VERSION, type: 'module', main: 'main.mjs' },
    null,
    2,
  ) + '\n',
)

// 4. 报告体积（解压后）
function size(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    n += e.isDirectory() ? size(p) : fs.statSync(p).size
  }
  return n
}
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'
console.log('✓', path.relative(ROOT, OUT))
console.log('  壳（Chromium + ffmpeg）', mb(size(OUT) - size(APP)))
console.log('  应用（dist + 入口）    ', mb(size(APP)))
console.log('  合计                  ', mb(size(OUT)))
