/**
 * agent.spec.ts — 控制平面在**真浏览器**里的验收（方案 §8 的 M0 / M1 / M2 / M4）。
 *
 * 为什么这几条必须在 E2E：WebGL 与 WebCodecs 在 Node 里不存在，而控制平面
 * 「看」与「导」这两条能力恰恰全落在这两个 API 上。单测只能守住读 / 写的**语义**
 * （`tests/unit/agent-control-plane.test.ts`），守不住「同一 t 两渲是否逐位相同」
 * 与「PNG 是不是上下颠倒」——那两条是 GPU 与读回路径的事。
 *
 * 通用纪律（与其它 spec 一致）：
 *   · 断言在 page 内做完 reduce，只回传标量；像素绝不出 page。
 *   · 导出产物算完立刻丢掉，不落盘（本 spec 不写磁盘，比 export-*.spec 更保守）。
 *   · `t` 是**秒**，会被控制平面吸附到帧栅格 —— 断言里给的都是落得下的值。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/** `window.__artmatic.control` 在本 spec 用到的部分。 */
interface ControlApi {
  describe(): Promise<unknown>;
  getScene(opt?: { t?: number; detail?: string }): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  getClip(clipId: string): Promise<unknown>;
  undoState(): Promise<unknown>;
  addTrack(kind: string, name?: string): Promise<unknown>;
  addClip(trackId: string, input: unknown): Promise<unknown>;
  removeClip(clipId: string): Promise<unknown>;
  moveClip(clipId: string, trackId: string, start: number): Promise<unknown>;
  setTransition(clipId: string, defId: string, duration: number): Promise<unknown>;
  setCurve(clipId: string, param: string, curve: unknown): Promise<unknown>;
  setProject(patch: unknown): Promise<unknown>;
  loadScene(project: unknown): Promise<unknown>;
  beginTx(): Promise<unknown>;
  endTx(label: string): Promise<unknown>;
  undo(): Promise<unknown>;
  redo(): Promise<unknown>;
  renderFrame(opt?: unknown): Promise<unknown>;
  readPixels(): Promise<unknown>;
  frameSignature(opt?: unknown): Promise<unknown>;
  snapshotPng(opt?: unknown): Promise<unknown>;
  export(opt: unknown): Promise<unknown>;
  exportBase64(opt: unknown): Promise<unknown>;
  exportState(): Promise<unknown>;
  abortExport(): Promise<unknown>;
}

interface Ok<T> {
  ok: true;
  data: T;
}
interface Err {
  ok: false;
  error: { code: string; message: string; detail?: unknown };
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);
  // `control` 是控制平面挂上去的那个键（方案 §2.3：与 `__artmatic` 同源演进）。
  await page.waitForFunction(
    () => Boolean((window as never as { __artmatic?: { control?: unknown } }).__artmatic?.control),
  );
  await openDemo(page);
}

/** 把一份**极小**的工程直接灌进去：deterministic 舞台，几百毫秒就能导完。 */
async function loadStage(page: Page, duration = 0.5): Promise<void> {
  await page.evaluate((dur) => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    // 上半红 / 下半蓝（`makeTestVideo` 用的是同一个形状）：一眼能看出上下方向。
    const mk = (id: string, color: string, y: number) => ({
      kind: 'source',
      id,
      start: 0,
      end: 4,
      label: color,
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y, sx: 1, sy: 0.5, rot: 0 },
      fit: 'stretch',
    });
    return C.loadScene({
      schemaVersion: 4,
      name: 'agent-e2e',
      seed: 0xa27a11c,
      fps: 30,
      resolution: { w: 320, h: 180 },
      duration: dur,
      beatGrid: { bpm: 120, offset: 0, beatsPerBar: 4 },
      overlapBehavior: 'reject',
      assets: {},
      tracks: [
        { kind: 'visual', id: 'v2', name: 'V2', enabled: true, clips: [mk('lo', '#0000ff', 0.25)] },
        { kind: 'visual', id: 'v1', name: 'V1', enabled: true, clips: [mk('hi', '#ff0000', 0.75)] },
      ],
    });
  }, duration);
}

test('M0：控制平面挂上了，且读接口是紧凑、确定、无副作用的', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(async () => {
    const A = (
      window as never as {
        __artmatic: {
          control: ControlApi;
          store: { version: number; project: { schemaVersion: number } };
        };
      }
    ).__artmatic;
    const C = A.control;

    const describe = (await C.describe()) as Ok<{ apiVersion: number; schemaVersion: number }>;
    const v0 = A.store.version;

    const full = (await C.getScene({ t: 0.5 })) as Ok<{
      t: number;
      tracks: { z: number | null; kind: string; clips: { id: string; active: boolean }[] }[];
    }>;
    const ids = (await C.getScene({ t: 0.5, detail: 'ids' })) as Ok<{
      tracks: { clips: Record<string, unknown>[] }[];
    }>;
    const caps = (await C.getCapabilities()) as Ok<{ effects: { id: string }[]; transitions: { id: string }[] }>;

    // detail:'ids' 的裁剪：片段上只有五个字段
    const idKeys = Object.keys(ids.data.tracks[0]!.clips[0] ?? {}).sort();
    // z 序：只数视觉轨，音频轨是 null
    const zs = full.data.tracks.map((tk) => tk.z);
    // 纯读的副作用：version 一动没动
    const versionAfterReads = A.store.version;

    return {
      apiVersion: describe.data.apiVersion,
      schemaVersion: describe.data.schemaVersion,
      // 不写死数字：这里是「握手报的版本 = 已迁移到当前版本的工程」这条不变量
      // （写死的话每次抬 SCHEMA_VERSION 都要来改它，而不是它挡住了什么）
      projectSchemaVersion: A.store.project.schemaVersion,
      idKeys,
      zs,
      visualCount: full.data.tracks.filter((tk) => tk.kind === 'visual').length,
      effectCount: caps.data.effects.length,
      transitionCount: caps.data.transitions.length,
      versionUnchanged: versionAfterReads === v0,
      // 每一条路径都必须是 { ok: ... } 的形状：异常跨传输层会丢类型
      allWrapped: [describe, full, ids, caps].every((r) => typeof (r as { ok: boolean }).ok === 'boolean'),
    };
  });

  expect(result.apiVersion).toBe(1);
  expect(result.schemaVersion).toBe(result.projectSchemaVersion);
  expect(result.idKeys).toEqual(['end', 'id', 'kind', 'label', 'start']);
  expect(result.zs.filter((z) => z !== null)).toEqual([...result.zs.filter((z) => z !== null)].sort((a, b) => b! - a!));
  expect(result.zs.filter((z) => z === null)).toHaveLength(result.zs.length - result.visualCount);
  expect(result.effectCount).toBeGreaterThan(5);
  expect(result.transitionCount).toBeGreaterThan(100);
  expect(result.versionUnchanged).toBe(true);
  expect(result.allWrapped).toBe(true);
});

test('M1：agent 加片段 → 用户 Ctrl+Z 撤得掉（撤销栈不许被绕过）', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    const scene = async (t: number) =>
      JSON.stringify(((await C.getScene({ t, detail: 'ids' })) as Ok<unknown>).data);

    const before = await scene(0.5);
    const track = (await C.addTrack('visual', 'AGENT')) as Ok<{ trackId: string }>;
    const added = (await C.addClip(track.data.trackId, {
      kind: 'solid',
      color: '#00ff00',
      start: 1,
      end: 2,
      id: 'agent-clip',
    })) as Ok<{ clipId: string }>;
    const during = await scene(1.5);
    const undoClip = (await C.undo()) as Ok<{ changed: boolean }>;
    const undoTrack = (await C.undo()) as Ok<{ changed: boolean }>;
    const after = await scene(0.5);

    return {
      clipId: added.data.clipId,
      duringHasClip: during.includes('agent-clip'),
      undoChanged: undoClip.data.changed && undoTrack.data.changed,
      // 两次撤销之后场景逐字节回到最初 —— 这是「写操作等值」的最终判据
      restored: after === before,
      canUndoAfter: ((await C.undoState()) as Ok<{ canUndo: boolean }>).data.canUndo,
    };
  });

  expect(result.clipId).toBe('agent-clip');
  expect(result.duringHasClip).toBe(true);
  expect(result.undoChanged).toBe(true);
  expect(result.restored).toBe(true);
});

test('M1：beginTx / endTx 把整段包成**一笔**撤销', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    const scene = async (t: number) =>
      JSON.stringify(((await C.getScene({ t, detail: 'ids' })) as Ok<unknown>).data);

    const track = (await C.addTrack('visual', 'AGENT-TX')) as Ok<{ trackId: string }>;
    const beforeTx = await scene(3.5);
    await C.beginTx();
    await C.addClip(track.data.trackId, { kind: 'solid', color: '#00ffff', start: 3, end: 4, id: 'tx-a' });
    await C.addClip(track.data.trackId, { kind: 'solid', color: '#ff00ff', start: 4, end: 5, id: 'tx-b' });
    const duringTx = await scene(3.5);
    const end = (await C.endTx('agent: 两段')) as Ok<{ changed: boolean }>;
    // 一笔撤销回到事务之前：两段一起消失（不是只回来一段）
    await C.undo();
    const afterUndo = await scene(3.5);
    return {
      duringHasBoth: duringTx.includes('tx-a') && duringTx.includes('tx-b'),
      endChanged: end.data.changed,
      bothGone: !afterUndo.includes('tx-a') && !afterUndo.includes('tx-b'),
      backToBefore: afterUndo === beforeTx,
    };
  });

  expect(result.duringHasBoth).toBe(true);
  expect(result.endChanged).toBe(true);
  expect(result.bothGone).toBe(true);
  expect(result.backToBefore).toBe(true);
});

test('M1：落点被策略拒绝时**整次不动**（agent 不该把工程改坏）', async ({ page }) => {
  await boot(page);
  await loadStage(page, 4);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    // hi 在 [0,4) 上铺满整条轨（duration 4 / 30fps）
    const before = ((await C.getScene({ t: 2, detail: 'ids' })) as Ok<{ tracks: { clips: unknown[] }[] }>).data;
    const moved = (await C.moveClip('lo', 'v1', 0.5)) as Err;
    const after = ((await C.getScene({ t: 2, detail: 'ids' })) as Ok<{ tracks: { clips: unknown[] }[] }>).data;
    const repeated = (await C.setTransition('hi', 'fade', 0.5)) as Err;
    return {
      moveCode: moved.ok ? null : moved.error.code,
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      transitionCode: repeated.ok ? null : repeated.error.code,
      // 落不了地的转场要给出**原因**（不是一句「失败」）
      transitionDetail: repeated.ok ? null : repeated.error.detail,
    };
  });

  expect(result.moveCode).toBe('conflict');
  expect(result.unchanged).toBe(true);
  expect(result.transitionCode).toBe('unsupported');
  expect(result.transitionDetail).toEqual({ reason: 'no-next' });
});

test('M2：同一 t 的指纹逐位相同，且上下方向正确', async ({ page }) => {
  await boot(page);
  await loadStage(page, 4);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    const sig = async () =>
      ((await C.frameSignature({ t: 0.5, grid: 4 })) as Ok<{
        w: number;
        h: number;
        t: number;
        mean: number[];
        spread: number;
        grid: number[];
        samples: number[];
        lit: number;
      }>).data;

    const a = await sig();
    const b = await sig();
    // 中灰度文字层之类的东西这里没有，所以画面是纯色块 ⇒ spread 由上下两块的颜色差给出
    const g = 4;
    const at = (row: number, col: number, ch: number) => a.samples[(row * g + col) * 3 + ch]!;
    return {
      w: a.w,
      h: a.h,
      t: a.t,
      identical: JSON.stringify(a) === JSON.stringify(b),
      mean: a.mean,
      spread: a.spread,
      topRed: at(0, 0, 0),
      topBlue: at(0, 0, 2),
      bottomRed: at(3, 0, 0),
      bottomBlue: at(3, 0, 2),
      rightTopRed: at(0, 3, 0),
      lit: a.lit,
    };
  });

  // 指纹默认小尺寸（320 宽），且 t 被吸附到帧栅格
  expect(result.w).toBe(320);
  expect(result.h).toBe(180);
  expect(result.t).toBeCloseTo(0.5, 9);
  expect(result.identical, '同一 t 两渲必须逐位相同').toBe(true);
  // ⚠️ 方向：上半红、下半蓝。**读回翻行**错了这里就会对调 —— 这是它唯一的守卫。
  expect(result.topRed).toBeGreaterThan(200);
  expect(result.topBlue).toBeLessThan(40);
  expect(result.bottomBlue).toBeGreaterThan(200);
  expect(result.bottomRed).toBeLessThan(40);
  expect(result.rightTopRed).toBeGreaterThan(200);
  // 铺满整幅 ⇒ 没有「空背景」可言，lit 应当覆盖几乎所有像素
  // （上下两块交界处允许一行的线性插值，所以不写 ==）
  expect(result.lit).toBeGreaterThan(result.w * result.h * 0.99);
  // 「这一帧有没有结构」用 spread，**不要用 mean**（AGENTS §5.6）
  expect(result.spread).toBeGreaterThan(100);
  // 逐通道 mean：红蓝各占一半 ⇒ R 与 B 都该在 127.5 附近（用标量均值会看不出来）
  expect(result.mean[0]!).toBeGreaterThan(100);
  expect(result.mean[2]!).toBeGreaterThan(100);
});

test('M2：readPixels / snapshotPng 交回的就是刚渲那一帧（不是一张黑图）', async ({ page }) => {
  await boot(page);
  await loadStage(page, 4);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    const r = (await C.renderFrame({ t: 0.5, size: { w: 64, h: 36 } })) as Ok<{ w: number; h: number }>;
    const px = (await C.readPixels()) as Ok<{ w: number; h: number; rgba: Uint8Array }>;
    const data = px.data.rgba;
    const at = (x: number, y: number, ch: number) => data[(y * px.data.w + x) * 4 + ch]!;
    // 左上角在**上半**（红），左下角在**下半**（蓝）—— 翻行错了就对调
    const png = (await C.snapshotPng({ t: 0.5, size: { w: 64, h: 36 } })) as Ok<Uint8Array>;
    // 像素一字节都不出 page：这里只回传标量。
    return {
      frame: r.data,
      readSize: { w: px.data.w, h: px.data.h },
      topLeftRed: at(0, 0, 0),
      topLeftBlue: at(0, 0, 2),
      bottomLeftBlue: at(0, px.data.h - 1, 2),
      bottomLeftRed: at(0, px.data.h - 1, 0),
      pngMagic: Array.from(png.data.slice(0, 8)),
      pngBytes: png.data.length,
    };
  });

  expect(result.frame).toEqual({ t: 0.5, w: 64, h: 36 });
  expect(result.readSize).toEqual({ w: 64, h: 36 });
  expect(result.topLeftRed).toBeGreaterThan(200);
  expect(result.topLeftBlue).toBeLessThan(40);
  expect(result.bottomLeftBlue).toBeGreaterThan(200);
  expect(result.bottomLeftRed).toBeLessThan(40);
  // PNG 魔数 89 50 4E 47 0D 0A 1A 0A
  expect(result.pngMagic).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.pngBytes).toBeGreaterThan(100);
});

test('M4：导出走 runExport 那条路 —— 产物可解析，且能取消', async ({ page }) => {
  await boot(page);
  await loadStage(page, 0.5);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    const png = (await C.export({ format: 'png' })) as Ok<{ bytes: number; mimeType: string }>;
    const mp4 = (await C.exportBase64({ format: 'mp4' })) as Ok<{ bytes: number; base64: string }>;
    const raw = atob(mp4.data.base64);
    // 容器自证：offset 4 起是 'ftyp'
    const ftyp = raw.slice(4, 8);
    return {
      png: { bytes: png.data.bytes, mime: png.data.mimeType },
      mp4: { bytes: mp4.data.bytes, ftyp, base64Len: mp4.data.base64.length },
      idle: (await C.exportState()) as Ok<unknown>,
    };
  });

  expect(result.png.bytes).toBeGreaterThan(100);
  expect(result.png.mime).toBe('application/zip');
  expect(result.mp4.bytes).toBeGreaterThan(500);
  expect(result.mp4.ftyp).toBe('ftyp');
  expect(result.mp4.base64Len).toBeGreaterThan(0);
  // 导完必须回到「没有导出在跑」
  expect(result.idle.data).toBeNull();
});

test('M4：导出中能取消（AbortSignal 一路到底）', async ({ page }) => {
  await boot(page);
  // 长一点：480 帧，够我们在中途按下取消
  await loadStage(page, 16);

  const result = await page.evaluate(async () => {
    const C = (window as never as { __artmatic: { control: ControlApi } }).__artmatic.control;
    // 不 await：让导出在页面里跑着，我们去按取消
    const running = C.export({ format: 'png' });
    await new Promise((r) => setTimeout(r, 150));
    const mid = (await C.exportState()) as Ok<{ frac: number; totalFrames: number } | null>;
    const abort = (await C.abortExport()) as Ok<{ aborted: boolean }>;
    const finished = (await running) as Err;
    return {
      midFrac: mid.data?.frac ?? -1,
      totalFrames: mid.data?.totalFrames ?? 0,
      aborted: abort.data.aborted,
      code: finished.ok ? null : finished.error.code,
      afterIdle: (await C.exportState()) as Ok<unknown>,
    };
  });

  expect(result.totalFrames).toBe(480);
  expect(result.aborted).toBe(true);
  expect(result.code).toBe('cancelled');
  expect(result.afterIdle.data).toBeNull();
});

test('安全边界：工具面是白名单，且页面里没有给 agent 的代码执行口', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(() => {
    const C = (window as never as { __artmatic: { control: Record<string, unknown> } }).__artmatic.control;
    const keys = Object.keys(C);
    return {
      keys,
      // 方案 §6.4 第 4 条：不做「任意代码执行」类工具
      hasEval: ['eval', 'exec', 'run', 'runScript', 'evaluate', 'Function'].filter((k) => keys.includes(k)),
      // 方案 §8 的 M6 建议装 WS，那是**可选项**：这里断言它确实没有实现，
      // 于是「生产构建里开了监听端口」这条风险根本不存在。
      hasWs: ['ws', 'websocket', 'listen', 'startServer'].filter((k) => keys.includes(k)),
    };
  });

  expect(result.keys.length).toBeGreaterThan(30);
  expect(result.hasEval).toEqual([]);
  expect(result.hasWs).toEqual([]);
});
