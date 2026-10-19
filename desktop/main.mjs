/**
 * desktop/main.mjs — 最小 Electron 宿主，用来验证「现有 web 产物在桌面壳里是否
 * 逐条成立」。
 *
 * 刻意只做四件事（对应 docs/electron-compat.md §3）：
 *   1. `app://` standard + secure scheme（不能用 loadFile：file:// 是 null origin，
 *      会关掉 IndexedDB / OPFS / FSA）
 *   2. `file-system-access-restricted` 一律放行并打印（先看清它拦了什么）
 *   3. 权限显式放行（Electron 默认全放行，这里写出来是为了留下痕迹）
 *   4. `--probe` 模式：在页面里跑一遍能力探针，打印 JSON + 截图，然后退出
 *
 * 不是产品代码。产品化的 IPC 版 platform 实现另做（见 W5）。
 */

// electron 44 的主入口在 ESM 下既不给具名导出（BrowserWindow 会报
// "does not provide an export named"），default 又是个空对象。
// 走 createRequire 拿真正的 CJS exports —— 这是唯一稳定的取法。
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import { installHost, ASSET_SCHEME } from './host.mjs'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, protocol, session, dialog, ipcMain, shell } = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dev：desktop/ 的兄弟目录；打包后：resources/app/dist。
const DIST = fsSync.existsSync(path.join(__dirname, 'dist'))
  ? path.join(__dirname, 'dist')
  : path.join(__dirname, '..', 'dist')
const PROBE = process.argv.includes('--probe')
const SHOW = process.argv.includes('--show')
const SW_GL = process.argv.includes('--sw')
const NO_SANDBOX = process.argv.includes('--nosandbox')
const DO_EXPORT = process.argv.includes('--export')
const CLOSE_TEST = process.argv.includes('--closetest')
/** 冒烟：验证 preload / IPC / Range 协议（打包产物里也走这条）。 */
const HOST_SMOKE = process.argv.includes('--host-smoke')
const BOOT_T0 = Date.now()

// 这些开关必须走 app.commandLine：直接当命令行参数传给 electron.exe 时，
// 本机会话下进程会被外层静默干掉（表现为无输出 + SIGTERM）。
if (SW_GL) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}
if (NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox')
// 截图与导出产物落在**当前工作目录**下：打包后 __dirname 在 resources/app 里，
// 往那儿写等于污染安装目录。
const OUT_DIR = path.join(process.cwd(), 'test-results')
const SHOT = path.join(OUT_DIR, 'electron-probe.png')

// 探针用独立 userData：默认的 `AppData/Roaming/Electron` 会被本机其它 Electron 应用
// 抢同一个 GPUPersistentCache 目录（报 "另一个程序正在使用此文件"），
// 而且探针不该污染用户的真实配置。打包后的产品用默认位置。
if (!app.isPackaged || PROBE) {
  app.setPath('userData', path.join(__dirname, '..', '.tmp-electron'))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
  ASSET_SCHEME,
])

/** 限制在 dist 内，不认 `..`。目录 → index.html；扩展名不存在 → SPA fallback。 */
function resolvePath(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, '')
  const full = path.resolve(DIST, clean)
  const rel = path.relative(DIST, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return full
}

async function serve(request) {
  try {
    const url = new URL(request.url)
    console.log('[serve]', request.url)
    if (url.host !== 'bundle') return new Response('bad host', { status: 400 })
    let file = resolvePath(url.pathname)
    if (!file) return new Response('bad path', { status: 400 })

    try {
      const stat = await fs.stat(file)
      if (stat.isDirectory()) file = path.join(file, 'index.html')
    } catch {
      // 文件不存在：有扩展名就是 404，否则按 SPA 回 index.html
      if (path.extname(file)) return new Response('not found', { status: 404 })
      file = path.join(DIST, 'index.html')
    }

    const body = await fs.readFile(file)
    return new Response(body, {
      headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' },
    })
  } catch (e) {
    console.error('[serve] failed', request.url, e)
    return new Response('handler error: ' + String(e), { status: 500 })
  }
}

const PROBE_SCRIPT = String.raw`(async () => {
  const out = { origin: location.origin, secure: window.isSecureContext };
  out.ua = navigator.userAgent;

  // WebGL2 + 浮点渲染目标（HDR 反馈历史全靠它）
  const cv = document.createElement('canvas');
  const gl = cv.getContext('webgl2');
  out.webgl2 = !!gl;
  if (gl) {
    out.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }

  // H.264 编码：三档 profile 分档打
  const ladder = {};
  for (const c of ['avc1.4d0028', 'avc1.4d401f', 'avc1.42E01E']) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c, width: 1280, height: 720, bitrate: 8e6, framerate: 30 });
      ladder[c] = r.supported;
    } catch (e) { ladder[c] = 'throw: ' + String(e); }
  }
  out.encode = ladder;

  // 真的编 30 帧（最有说服力的一条）
  let chunks = 0, bytes = 0, firstChunkType = null;
  try {
    const c2 = document.createElement('canvas');
    c2.width = 640; c2.height = 360;
    const g = c2.getContext('2d');
    const encoder = new VideoEncoder({
      output: (chunk) => { chunks++; bytes += chunk.byteLength; firstChunkType = firstChunkType ?? chunk.type; },
      error: (e) => { out.encodeError = String(e); },
    });
    encoder.configure({ codec: 'avc1.42E01E', width: 640, height: 360, bitrate: 2e6, framerate: 30 });
    for (let i = 0; i < 30; i++) {
      g.fillStyle = 'hsl(' + (i * 12) + ' 90% 50%)';
      g.fillRect(0, 0, 640, 360);
      const f = new VideoFrame(c2, { timestamp: i * 33333, duration: 33333 });
      encoder.encode(f, { keyFrame: i === 0 });
      f.close();
    }
    await encoder.flush();
    encoder.close();
    out.encodedFrames = chunks;
    out.encodedBytes = bytes;
    out.firstChunk = firstChunkType;
  } catch (e) { out.encodeError = String(e); }

  out.decode = await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01E', codedWidth: 640, codedHeight: 360 })
    .then((r) => r.supported).catch((e) => 'throw: ' + String(e));

  out.aac = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })
    .then((r) => r.supported).catch((e) => 'throw: ' + String(e));

  // 存储三件套：scheme 决策的验收点
  try { localStorage.setItem('__probe', '1'); out.localStorage = localStorage.getItem('__probe') === '1'; }
  catch (e) { out.localStorage = 'throw: ' + String(e); }
  out.indexedDB = typeof indexedDB !== 'undefined';
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('__probe.txt', { create: true });
    const w = await fh.createWritable();
    await w.write('ok');
    await w.close();
    out.opfs = (await (await fh.getFile()).text()) === 'ok';
  } catch (e) { out.opfs = 'throw: ' + String(e); }

  // 其余 API 的存在性 / 实际能力
  out.fsa = typeof window.showDirectoryPicker;
  out.savePicker = typeof window.showSaveFilePicker;
  out.eyeDropper = typeof window.EyeDropper;
  out.clipboardItem = typeof window.ClipboardItem;
  try {
    const fonts = await window.queryLocalFonts();
    out.localFonts = fonts.length;
  } catch (e) { out.localFonts = 'throw: ' + String(e); }

  // 应用真的挂上了没有
  out.mounted = !!document.querySelector('[data-testid="empty-state"]') || !!document.querySelector('.app');
  out.title = document.title;
  return out;
})()`

function allowPermissions(ses) {
  const allow = new Set(['fileSystem', 'local-fonts', 'clipboard-sanitized-write', 'clipboard-read', 'media'])
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allow.has(permission) || true))
  ses.setPermissionCheckHandler(() => true)
  ses.on('file-system-access-restricted', (_e, details, callback) => {
    console.log('[restricted]', details.path, details.isDirectory ? '(dir)' : '(file)')
    callback('allow')
  })
}

/**
 * 宿主冒烟：验证「preload 桥 / IPC 按范围读 / 自定义协议 + Range」。
 *
 * 跑在**打包产物**里（`release/.../Artmatic.exe --host-smoke --nosandbox`），
 * 所以它验的是用户真正会拿到的那份 main/preload/host，而不是 dev 路径。
 */
async function runHostSmoke(win) {
  const dir = path.join(process.cwd(), 'test-results')
  await fs.mkdir(dir, { recursive: true })
  const asset = path.join(dir, 'electron-host-smoke.bin')
  const payload = Buffer.alloc(256 * 1024)
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251
  await fs.writeFile(asset, payload)

  // 记录「宿主脚本接手时」启动画面还在不在（正常情况下 bundle 还在解析）。
  const early = await win.webContents
    .executeJavaScript(
      `({ splash: !!document.getElementById('boot-splash'), t: Math.round(performance.now()) })`,
      true,
    )
    .catch(() => null)
  console.log('[startup] splash-at-handler', JSON.stringify(early))

  await new Promise((r) => setTimeout(r, 2500))
  const result = await win.webContents.executeJavaScript(
    `(async () => {
      const host = window.artmaticHost;
      if (!host) return { error: 'no bridge' };
      await host.__smokeAllow(${JSON.stringify(asset)});
      const url = await host.__smokeUrl(${JSON.stringify(asset)});
      const direct = await host.readRange(${JSON.stringify(asset)}, 0, 4);
      const res = await fetch(url, { headers: { Range: 'bytes=5-14' } });
      const body = new Uint8Array(await res.arrayBuffer());
      const head = await fetch(url, { method: 'HEAD' });
      const st = await host.stat(${JSON.stringify(asset)});
      return {
        bridge: true,
        direct: Array.from(direct),
        status: res.status,
        range: res.headers.get('content-range'),
        len: body.length,
        body: Array.from(body),
        headStatus: head.status,
        headLen: head.headers.get('content-length'),
        size: st.size,
        platform: window.__artmatic?.platform?.supportsLinked ?? null,
        mounted: !!document.querySelector('.app') || !!document.querySelector('[data-testid="empty-state"]'),
        splashGone: !document.getElementById('boot-splash'),
      };
    })()`,
    true,
  )
  console.log('[host-smoke]', JSON.stringify(result))

  /*
   * 第二段：真的按路径导入一个视频，再打包。
   *
   * 这一段才验证到 `CustomSource`（mediabunny 按 Range 读）与 `AssetStore.open`
   * 的 path 分支 —— 只测 IPC 只能证明「管道通了」，证明不了「解码器能用」。
   */
  let linked = null
  const video = process.env.ARTMATIC_SMOKE_VIDEO
  if (video && fsSync.existsSync(video)) {
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-testid="empty-demo"]')?.click(); 1`,
      true,
    )
    await new Promise((r) => setTimeout(r, 3200))
    linked = await win.webContents.executeJavaScript(
      `(async () => {
        const A = window.__artmatic;
        const host = window.artmaticHost;
        await host.__smokeAllow(${JSON.stringify(video)});
        const st = await host.stat(${JSON.stringify(video)});
        const out = await A.project.importLinkedPath('video', 'smoke.mp4', ${JSON.stringify(video)}, st.size, { trackId: null });
        if (!out) return { error: 'import failed' };
        const media = await A.assets.openVideo(out.assetId);
        const pack = await A.project.packToOpfs('host-smoke.artmatic');
        return {
          id: out.assetId,
          mode: A.assets.modeOf(out.assetId),
          mediaKind: media?.kind ?? null,
          mediaSize: media?.size ?? null,
          pack,
        };
      })()`,
      true,
    )
    console.log('[host-smoke:linked]', JSON.stringify(linked))
  }

  const ok =
    !!result &&
    result.bridge === true &&
    result.status === 206 &&
    result.len === 10 &&
    result.body[0] === 5 &&
    result.body[9] === 14 &&
    result.headStatus === 200 &&
    Number(result.headLen) === payload.length &&
    result.size === payload.length &&
    result.platform === true &&
    result.mounted === true &&
    result.splashGone === true &&
    (!video ||
      (!!linked &&
        !linked.error &&
        linked.mode === 'linked' &&
        linked.mediaKind === 'path' &&
        linked.pack?.assets >= 1 &&
        linked.pack?.bytes > 1_000_000))
  console.log('[host-smoke]', ok ? 'PASS' : 'FAIL')
  setTimeout(() => app.exit(ok ? 0 : 1), 200)
}

async function main() {
  await app.whenReady()

  protocol.handle('app', serve)
  installHost({ app, protocol, ipcMain, dialog, shell })
  allowPermissions(session.defaultSession)
  watchDownloads()

  console.log('[gpu]', JSON.stringify(app.getGPUFeatureStatus(), null, 2))
  console.log('[dist]', DIST, 'exists =', await fs.stat(DIST).then(() => true, () => false))

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    /*
     * 正常启动先不显示：等 `ready-to-show`（此时 index.html 的内联启动画面
     * 已经画出来了）。用户看到的第一帧是品牌画面，而不是一块黑窗。
     * `--show` / 探针保留原来的显式行为。
     */
    show: SHOW,
    backgroundColor: '#111114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 隐藏窗口里 rAF 会被暂停（fps 读出来是 1），所以性能测量必须 --show。
      backgroundThrottling: false,
      // 产品值应为 true。本机这个会话里沙箱渲染进程起不来
      // （render-process-gone: crashed / 0x80000003），探针跑 --nosandbox。
      sandbox: !NO_SANDBOX,
      additionalArguments: HOST_SMOKE ? ['--artmatic-smoke'] : [],
    },
  })

  win.once('ready-to-show', () => {
    console.log('[startup] ready-to-show', Date.now() - BOOT_T0, 'ms')
    if (win.isDestroyed()) return
    if (!PROBE || SHOW) win.show()
  })

  win.webContents.once('did-finish-load', () => {
    console.log('[startup] did-finish-load', Date.now() - BOOT_T0, 'ms')
  })

  // 兜底：某些驱动上 ready-to-show 可能不触发；不能让用户对着不存在窗口发呆。
  if (!PROBE && !HOST_SMOKE) {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    }, 8000)
  }

  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[renderer:' + level + ']', message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-gone]', JSON.stringify(details))
  })
  app.on('child-process-gone', (_e, details) => {
    console.error('[child-gone]', JSON.stringify(details))
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[load-failed]', code, desc, url)
  })

  /**
   * 关窗守卫。
   *
   * 页面里有 `beforeunload`（`App.svelte` 的 onBeforeUnload，`anyDirty` 时
   * preventDefault）。浏览器会自己弹「离开此网站？」；**Electron 不会** ——
   * 没有这个 handler 时，窗口直接关不掉，X / Ctrl+W / Alt+F4 全部静默失效，
   * 只能任务管理器强杀。所以这里必须补一个原生确认框，并在用户选择
   * 「放弃并退出」时 `preventDefault()`（Electron 的语义是**忽略页面的拦截**）。
   */
  win.webContents.on('will-prevent-unload', (event) => {
    const auto = process.env.ARTMATIC_CLOSE_ANSWER
    const choice =
      auto === 'discard' ? 1
      : auto === 'cancel' ? 0
      : dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: ['取消', '放弃改动并退出'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          title: '有未保存的改动',
          message: '还有工程没有保存。',
          detail: '现在退出会丢失这些改动。取消可以回到 Artmatic 里保存。',
        })
    console.log('[close] dirty prompt ->', choice === 1 ? 'discard' : 'cancel')
    if (choice === 1) event.preventDefault()
  })

  // 没有应用菜单就没有 Ctrl+W 的默认加速键 —— 手动接一条，走同一条关窗路径
  // （所以脏工程一样会弹上面的确认框）。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (mod && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      event.preventDefault()
      win.close()
    }
  })

  await win.loadURL('app://bundle/')
  console.log('[loaded]', win.webContents.getURL())

  if (HOST_SMOKE) return runHostSmoke(win)

  if (!PROBE) return

  // 等挂载 + 首帧
  await new Promise((r) => setTimeout(r, 2500))
  const result = await win.webContents.executeJavaScript(PROBE_SCRIPT, true)
  console.log('[probe]', JSON.stringify(result, null, 2))

  // 顺手点一次「载入演示」，看真的能不能渲染
  try {
    await win.webContents.executeJavaScript(
      `document.querySelector('[data-testid="empty-demo"]')?.click(); 'clicked'`,
      true,
    )
    await new Promise((r) => setTimeout(r, 4000))
    const after = await win.webContents.executeJavaScript(
      `({ demo: !!document.querySelector('[data-testid="empty-state"]'), canvases: document.querySelectorAll('canvas').length })`,
      true,
    )
    console.log('[demo]', JSON.stringify(after))

    // rAF 实测。隐藏窗口的 visibilityState = hidden，rAF 会被暂停（读出来 fps = 1），
    // 所以这条只在 --show 下有意义。
    const raf = await win.webContents.executeJavaScript(
      `new Promise((resolve) => {
        let n = 0; const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
          else resolve({ rafFps: Math.round(n / ((performance.now() - t0) / 1000)), visibility: document.visibilityState });
        };
        requestAnimationFrame(tick);
      })`,
      true,
    )
    console.log('[raf]', JSON.stringify(raf))
  } catch (e) {
    console.error('[demo] failed', e)
  }

  if (DO_EXPORT) await driveExport(win)

  if (CLOSE_TEST) {
    // 演示工程是「尚未保存」状态 ⇒ anyDirty 为真 ⇒ 页面 beforeunload 会拦。
    // 走真实的输入路径（Ctrl+W），验证守卫接线而不是直接调 win.close()。
    console.log('[closetest] dirty =', await win.webContents.executeJavaScript('1', true))
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] })
    await new Promise((r) => setTimeout(r, 2000))
    if (win.isDestroyed()) {
      console.log('[closetest] window closed')
    } else {
      console.log('[closetest] window still open')
      app.exit(0)
    }
    return
  }

  await fs.mkdir(path.dirname(SHOT), { recursive: true })
  const img = await win.webContents.capturePage()
  await fs.writeFile(SHOT, img.toPNG())
  console.log('[shot]', SHOT)

  // app.quit() 在本机会话里会挂住（network service 正在崩），直接 exit。
  setTimeout(() => app.exit(0), 200)
}

/**
 * 走一遍产品的导出入口：侧栏「导出」→ 点 MP4。
 *
 * 24s / 1080p 的预计体积远小于 exportMemoryMB，所以不会弹保存对话框，
 * 走的是 `browserPlatform.download`（blob + a.download）—— 正好可以在这里拦
 * `will-download` 落到指定目录，从而验证「编码 → 封装 → 落盘」整条链。
 */
async function driveExport(win) {
  // Svelte 的 DOM 更新是微任务，点开面板后同步 query 一定拿不到按钮 —— 必须等。
  await win.webContents.executeJavaScript(`document.querySelector('[data-testid="rail-export"]')?.click(); 1`, true)
  await new Promise((r) => setTimeout(r, 600))

  const clicked = await win.webContents.executeJavaScript(
    `(() => {
      const mp4 = document.querySelector('[data-testid="export-mp4"]');
      if (!mp4) return 'no-export-button';
      if (mp4.disabled) return 'disabled: ' + (document.querySelector('[data-testid="export-mp4-hint"]')?.textContent ?? '');
      mp4.click();
      return 'clicked';
    })()`,
    true,
  )
  console.log('[export] ui', clicked)

  const t0 = Date.now()
  while (Date.now() - t0 < 180_000) {
    if (downloadResult) {
      console.log('[export] done', JSON.stringify(downloadResult))
      console.log('[export] elapsed', ((Date.now() - t0) / 1000).toFixed(1) + 's')
      return
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('[export] timeout (180s)')
}

let downloadResult = null

function watchDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    const dest = path.join(OUT_DIR, item.getFilename())
    item.setSavePath(dest)
    console.log('[download] start', item.getFilename(), item.getTotalBytes())
    item.once('done', (_ev, state) => {
      downloadResult = { state, path: dest, bytes: item.getReceivedBytes() }
      console.log('[download] done', JSON.stringify(downloadResult))
    })
  })
}

main().catch((e) => {
  console.error('[fatal]', e)
  app.exit(1)
})
