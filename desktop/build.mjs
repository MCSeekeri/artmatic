/**
 * desktop/build.mjs — 打一个**免安装的便携目录**，不引 electron-builder。
 *
 * 产物：release/Artmatic-<version>-win32-x64/Artmatic.exe
 *   resources/app/{main.mjs, preload.cjs, host.mjs, icon.ico, package.json, dist/}
 *
 * 为什么不用 electron-builder：这一步只是「让现有 web 产物在桌面壳里真的跑起来」，
 * 需要的是可复现、可 diff 的最小结构。安装包 / 签名 / 自动更新属于发行流程，
 * 等桌面壳通过验收再引。
 *
 * 用法：
 *   pnpm run build && node desktop/build.mjs
 *
 * 不走 `pnpm run desktop:artifact`（它前面还有一步 `install-electron`：本机下载
 * Electron 走不通，会把这条命令卡死在第一步）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

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

/**
 * 改写可执行文件的图标与版本信息。
 *
 * 窗口 / 任务栏那个图标走 `BrowserWindow.icon`（见 `main.mjs`），但**资源管理器里
 * 这个文件**的图标是 exe 自己的 PE 资源 —— 不改文件本身，用户拿到的就是 Electron
 * 官方图标，一眼看得出是套壳。
 *
 * 用 `resedit`（纯 JS 读写 PE，devDependency，不进产物）：它负责重排 `.rsrc` 与
 * 目录项 —— 手动算 section 偏移是纯自找麻烦。顺带把那串 "Electron" 版本信息换掉，
 * 文件属性的「详细信息」栏读的就是它。
 *
 * **会丢掉 Authenticode 签名**（改字节必然）。Electron 官方 Windows 包本来就没签，
 * 我们也没签，没有实际损失。
 */
function patchExeIcon(exePath) {
  if (process.platform !== 'win32') return // 只有 Windows 会看 PE 资源
  const icoPath = path.join(__dirname, 'icon.ico')
  if (!fs.existsSync(icoPath)) {
    fail(`找不到 ${path.relative(ROOT, icoPath)}，先跑 node scripts/make-icon.mjs`)
  }

  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const res = NtExecutableResource.from(exe)
  const icons = Data.IconFile.from(fs.readFileSync(icoPath)).icons.map((i) => i.data)

  /*
   * **每一组都换**：electron.exe 里不止一组图标（主图标之外还有给文档 / 协议关联
   * 用的），只换第一组的话，某些视图里仍会露出 Electron 的图标。
   */
  const groups = Resource.IconGroupEntry.fromEntries(res.entries)
  if (groups.length === 0) {
    Resource.IconGroupEntry.create(res.entries, 1, 1033, icons)
  } else {
    for (const g of groups) {
      Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons)
    }
  }

  const [vi] = Resource.VersionInfo.fromEntries(res.entries)
  if (vi) {
    const lang = vi.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 }
    vi.setStringValues(lang, {
      FileDescription: 'Artmatic',
      ProductName: 'Artmatic',
      OriginalFilename: 'Artmatic.exe',
      InternalName: 'Artmatic',
    })
    // 版本号跟 package.json 走（Electron 那一版 44.9.3 在文件属性里没有意义）。
    vi.setFileVersion(VERSION, lang.lang)
    vi.setProductVersion(VERSION, lang.lang)
    vi.outputToResourceEntries(res.entries)
  }

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log('  图标 / 版本信息   ', `已写入 ${path.basename(exePath)}`)
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
patchExeIcon(path.join(OUT, EXE))

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
//    `icon.ico` 与 main.mjs 同目录（`main.mjs` 按 `__dirname/icon.ico` 找），
//    由 `scripts/make-icon.mjs` 从品牌 SVG 生成。
for (const f of ['main.mjs', 'preload.cjs', 'host.mjs', 'icon.ico']) {
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
