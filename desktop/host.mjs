/**
 * desktop/host.mjs — Electron 主进程侧的素材宿主。
 *
 * 三件事：
 *   1. `artmatic-asset://` 协议：按 Range 返回本机文件（视频 seek 靠它），
 *      只认注册过的 token，不认任意路径。
 *   2. IPC：原生选择器、按范围读、stat、监视、在文件管理器中显示。
 *   3. 安全边界：所有路径先过 allowlist（用户亲手选过的文件），页面拿不到 fs。
 *
 * 这个文件是**产品代码**（不是探针）：`main.mjs` 在 app ready 后安装它，
 * `preload.cjs` 只暴露白名单方法。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

/** 与 `app` 同一个 `registerSchemesAsPrivileged` 调用里注册。 */
export const ASSET_SCHEME = {
  scheme: 'artmatic-asset',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    // 自定义 scheme 默认不一定参与 CORS；显式打开，`app://` 才能 fetch 它。
    corsEnabled: true,
  },
}

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.artmatic': 'application/zip',
}

const FILTERS = {
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
  video: [{ name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv'] }],
}

const trim = (p) => path.resolve(String(p))

export function installHost({ app, protocol, ipcMain, dialog, shell }) {
  /** 用户亲手选过 / 明确允许的文件。**没有这个集合就什么都不给读。** */
  const allowed = new Set()
  /** token → 绝对路径。协议只认这里。 */
  const tokens = new Map()

  const allow = (p) => {
    const abs = trim(p)
    allowed.add(abs)
    return abs
  }
  const permitted = (p) => allowed.has(trim(p))

  const tokenFor = (abs) => {
    const token = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 24)
    tokens.set(token, abs)
    return token
  }
  const urlFor = (abs) => `artmatic-asset://asset/${tokenFor(abs)}`

  protocol.handle('artmatic-asset', async (req) => {
    try {
      const url = new URL(req.url)
      if (url.hostname !== 'asset') return new Response('bad host', { status: 400 })
      const abs = tokens.get(url.pathname.replace(/^\//, ''))
      if (!abs) return new Response('unknown asset', { status: 404 })

      const st = await fsp.stat(abs).catch(() => null)
      if (!st?.isFile()) return new Response('not found', { status: 404 })

      const headers = {
        'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        // app:// 与 artmatic-asset:// 是两个 origin；视频 fetch 需要这两条。
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range, content-length',
      }
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...headers,
            'access-control-allow-headers': 'range',
            'access-control-allow-methods': 'GET,HEAD,OPTIONS',
          },
        })
      }

      const range = req.headers.get('range')
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
        if (!m) return new Response('bad range', { status: 416 })
        const start = m[1] ? Number(m[1]) : 0
        const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1
        if (!Number.isFinite(start) || start >= st.size || end < start) {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'content-range': `bytes */${st.size}` },
          })
        }
        // Node 的 `createReadStream` 的 `end` 是**包含**的（与 HTTP Range 一致）。
        return new Response(Readable.toWeb(fs.createReadStream(abs, { start, end })), {
          status: 206,
          headers: {
            ...headers,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${st.size}`,
          },
        })
      }

      if (req.method === 'HEAD') {
        return new Response(null, { headers: { ...headers, 'content-length': String(st.size) } })
      }
      return new Response(Readable.toWeb(fs.createReadStream(abs)), {
        headers: { ...headers, 'content-length': String(st.size) },
      })
    } catch (e) {
      console.error('[asset] handler failed', e)
      return new Response('handler error', { status: 500 })
    }
  })

  ipcMain.handle('artmatic:pickLinked', async (_e, kind) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: FILTERS[kind] ?? FILTERS.video,
    })
    if (canceled || !filePaths[0]) return null
    const abs = allow(filePaths[0])
    const st = await fsp.stat(abs)
    return { path: abs, name: path.basename(abs), size: st.size, mtime: st.mtimeMs }
  })

  ipcMain.handle('artmatic:pickArchive', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Artmatic package', extensions: ['artmatic'] }],
    })
    if (canceled || !filePaths[0]) return null
    const abs = allow(filePaths[0])
    const st = await fsp.stat(abs)
    return { path: abs, name: path.basename(abs), size: st.size }
  })

  /**
   * 拖拽入口的授权：路径来自 preload 的 `webUtils.getPathForFile`（用户刚把文件
   * 拖进来），与原生选择器是同一种「用户明确选择」。
   *
   * 用同步 IPC 的唯一理由：必须在 preload 返回路径**之前**完成登记，否则紧随
   * 其后的 `readRange` 会以「path not allowed」失败。它不暴露给页面。
   */
  ipcMain.on('artmatic:allowPath-sync', (e, p) => {
    if (typeof p === 'string' && p) allow(p)
    e.returnValue = true
  })

  ipcMain.handle('artmatic:readFile', async (_e, p) => {
    if (!permitted(p)) throw new Error('path not allowed')
    return new Uint8Array(await fsp.readFile(trim(p)))
  })

  ipcMain.handle('artmatic:stat', async (_e, p) => {
    if (!permitted(p)) return null
    const st = await fsp.stat(trim(p)).catch(() => null)
    return st?.isFile() ? { size: st.size, mtime: st.mtimeMs } : null
  })

  ipcMain.handle('artmatic:readRange', async (_e, p, start, end) => {
    if (!permitted(p)) throw new Error('path not allowed')
    const abs = trim(p)
    const st = await fsp.stat(abs)
    const s = Math.max(0, Math.floor(Number(start) || 0))
    const e = Math.min(st.size, Math.max(s, Math.floor(Number(end) || 0)))
    if (e <= s) return new Uint8Array(0)
    const fh = await fsp.open(abs, 'r')
    try {
      const buf = Buffer.alloc(e - s)
      await fh.read(buf, 0, buf.length, s)
      return new Uint8Array(buf)
    } finally {
      await fh.close()
    }
  })

  ipcMain.handle('artmatic:showInFolder', (_e, p) => {
    if (permitted(p)) shell.showItemInFolder(trim(p))
  })

  /** 每个窗口只监视一组；重开工程时整体替换。 */
  let watchers = []
  const closeWatchers = () => {
    for (const w of watchers) {
      try {
        w.close()
      } catch {
        /* 已关 */
      }
    }
    watchers = []
  }
  app.on('will-quit', closeWatchers)
  app.on('window-all-closed', closeWatchers)

  ipcMain.handle('artmatic:watch', (e, paths) => {
    closeWatchers()
    const wc = e.sender
    for (const p of Array.isArray(paths) ? paths : []) {
      if (!permitted(p)) continue
      try {
        let timer = null
        const w = fs.watch(trim(p), { persistent: false }, () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            if (!wc.isDestroyed()) wc.send('artmatic:asset-changed', trim(p))
          }, 250)
        })
        watchers.push(w)
      } catch (err) {
        console.warn('[watch] failed', p, err?.message ?? err)
      }
    }
    return watchers.length
  })

  ipcMain.handle('artmatic:unwatch', () => {
    closeWatchers()
    return true
  })

  /*
   * 冒烟入口只在测试参数下注册。它仍然是「allow 一次 + 拿 token」，
   * 不开新能力 —— 只是把「选文件」这一步换成脚本给路径。
   */
  if (
    process.argv.includes('--artmatic-smoke') ||
    process.argv.includes('--host-smoke')
  ) {
    ipcMain.handle('artmatic:smokeAllow', (_e, p) => allow(p))
    ipcMain.handle('artmatic:smokeUrl', (_e, p) => urlFor(allow(p)))
  }

  return { allow, urlFor, stop: closeWatchers }
}
