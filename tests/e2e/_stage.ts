/**
 * _stage.ts — 渲染类用例的共用脚手架（**不是** spec，不会被 playwright 收集）。
 *
 * 为什么需要它：2026-10-03 查清那批「已知 flaky」时发现，凡是直接往
 * **demo 工程**上叠加片段的用例，都会踩同样两个坑：
 *
 *   1. `ProjectStore.addTrack` 是 `p.tracks.push(...)` —— 新轨落在**数组末尾 =
 *      z 最低 = 最底层**。用例全都按「新轨在最上面」写，于是被测对象被 demo 的
 *      轨道整个遮住。实测：把画面隔离到只剩用例自己那两条轨后，
 *      **开关 slices 轨对画面的影响是 0 个像素** —— 那两条用例其实在测 demo 工程。
 *
 *   2. demo 的 `echo` 是**反馈型**特效（跨帧历史）。连渲同一 t 而中间不清历史，
 *      第二次读到的是第一次写进去的历史 —— 这本来就不该一致。
 *      `determinism.spec.ts` 的注释早就写明了这条契约（「连渲同一 t 不清历史是
 *      在泵历史，本身就不该一致」），并且它每次渲前都 `onSeek()`；
 *      而其它几条既不清历史、栈里又留着 echo。
 *
 * 所以渲染类用例统一从**空舞台**起步，并由这里保证「特效在源之上」。
 *
 * > 约定说明：本目录原先每个 spec 自带 `boot()`、不共享文件。这里破例开一个
 * > 共用模块，是因为上面两条坑已经在三个 spec 里各踩一遍 —— 同一段
 * > 「关 demo 轨 + 把特效置顶 + 清反馈」的代码抄三份，下次还会漏掉其中一份。
 */

import type { Page } from '@playwright/test';

/* ------------------------------------------------------------------ 类型 */

/** `window.__artmatic` 里本模块用到的部分。 */
interface StageApi {
  store: {
    addTrack: (kind: 'visual', name?: string) => string;
    addClip: (trackId: string, clip: unknown) => void;
    setTransitionOut: (
      clipId: string,
      defId: string,
      duration: number,
      values: Record<string, number>,
    ) => void;
    clearTransitionOut: (clipId: string) => void;
    commit: (
      label: string,
      fn: (p: { tracks: { id: string; enabled: boolean; clips: unknown[] }[] }) => void,
    ) => void;
  };
  renderer: { onSeek: () => void };
  renderFrame: (t: number) => void;
  readPixels: () => { data: number[]; w: number; h: number };
  algo: { defaultParams: (id: string) => Record<string, number | string> };
}

export type StageSource =
  | { type: 'algo'; generator: string; params?: Record<string, number | string> }
  | { type: 'solid'; color: string };

export interface SourceSpec {
  id: string;
  source: StageSource;
  start?: number;
  end?: number;
  blend?: string;
  opacity?: number;
  curves?: Record<string, unknown>;
}

export interface EffectSpec {
  id: string;
  defId: string;
  values: Record<string, number | string>;
  start?: number;
  end?: number;
}

export interface Stage {
  sourceTrack: string;
  /** 传了 effect 才有。 */
  effectTrack: string | null;
}

/* ------------------------------------------------------------ 页面内工具 */

/*
 * ⚠️ `page.evaluate` 的回调会被**序列化后送进页面**，所以它**读不到本模块
 * 作用域里的任何东西**（函数、常量都不行）。每个回调里必须就地写
 * `(window as never as { __artmatic: StageApi }).__artmatic`。
 * 这个坑踩过一次：抽出去一个 `api()` 助手，运行期报 `api is not defined`。
 */

/* ------------------------------------------------------------------ API */

/**
 * 关掉 demo 全部轨道，搭一条属于自己的「源 →（可选）特效」干净栈。
 *
 * 保证：特效轨**在源轨之上**（adjustment layer 语义 —— 这是 `buildStack`
 * 把 `tracks[0]` 映射成最大 z 的直接后果）。
 */
export async function buildStage(
  page: Page,
  source: SourceSpec,
  effect?: EffectSpec,
): Promise<Stage> {
  return page.evaluate(
    ({ source, effect }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      const base = { fadeSec: 0, curves: {}, transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'stretch' };

      // 1) 先把 demo 的轨道全关掉：否则被测对象会被它们遮住（而且 demo 的
      //    echo 是反馈型，会给「同帧一致」类断言带来跨帧历史）。
      A.store.commit('e2e: 清空舞台', (p) => {
        for (const t of p.tracks) t.enabled = false;
      });

      // 2) 源轨先加（先加 = 数组更靠前 = z 更高）
      const sourceTrack = A.store.addTrack('visual');
      A.store.addClip(sourceTrack, {
        ...base,
        curves: source.curves ?? {},
        kind: 'source',
        id: source.id,
        start: source.start ?? 0,
        end: source.end ?? 8,
        label: source.id,
        source:
          source.source.type === 'algo'
            ? {
                type: 'algo',
                generator: source.source.generator,
                params: source.source.params ?? A.algo.defaultParams(source.source.generator),
              }
            : { type: 'solid', color: source.source.color },
        blend: source.blend ?? 'normal',
        opacity: source.opacity ?? 1,
      });

      // 3) 特效轨后加（= 数组更靠后 = z 更低），再把它提到数组最前，
      //    让它在源**之上**。addTrack 的 push 语义见文件头注释。
      let effectTrack: string | null = null;
      if (effect) {
        effectTrack = A.store.addTrack('visual');
        A.store.addClip(effectTrack, {
          ...base,
          kind: 'effect',
          id: effect.id,
          start: effect.start ?? 0,
          end: effect.end ?? 8,
          label: effect.id,
          chain: [{ instanceId: `${effect.id}-i`, defId: effect.defId, enabled: true, values: effect.values }],
        });
        const fx = effectTrack;
        A.store.commit('e2e: 特效置顶', (p) => {
          const i = p.tracks.findIndex((t) => t.id === fx);
          const [moved] = p.tracks.splice(i, 1);
          p.tracks.unshift(moved!);
        });
      }

      // 4) 只启用我们自己的轨
      A.store.commit('e2e: 启用舞台', (p) => {
        for (const t of p.tracks) t.enabled = t.id === sourceTrack || t.id === effectTrack;
      });

      return { sourceTrack, effectTrack };
    },
    { source, effect },
  );
}

/** 开/关一条轨（用来断言「被测特效真的出现在画面上」）。 */
export async function setTrackEnabled(page: Page, trackId: string, enabled: boolean): Promise<void> {  await page.evaluate(
    ({ trackId, enabled }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      A.store.commit('e2e: 开关轨', (p) => {
        for (const t of p.tracks) if (t.id === trackId) t.enabled = enabled;
      });
    },
    { trackId, enabled },
  );
}

/**
 * warm-up 的收敛判据：连续这么多帧完全一致就认为「稳定了」。
 *
 * 起因是一个**一次性过渡**（刻画见 `.workbuddy/probe-flaky-root*.mjs` 与
 * AGENTS §7）：页面加载后的头几次求值之内，画面水平正中的一个像素会翻到
 * 另一个值（量级 110），然后彻底稳定。它触发在**第 2–3 次求值之间**，
 * 时机随机器负载浮动。
 *
 * **不能用固定帧数**：实测「空渲 2 帧」仍会挂。必须用收敛判据。
 * `determinism.spec.ts` 里有一份同规则的实现（它必须在单个 `page.evaluate`
 * 内完成，用不了 Node 侧助手），改这里时那份要一起改。
 */
export const SETTLE_FRAMES = 6;

/** 渲到稳定为止（最多 SETTLE_CAP 帧），保证之后任何两次比较都不受那个过渡影响。 */
export async function settle(page: Page, t: number, settleFrames = SETTLE_FRAMES): Promise<void> {
  await page.evaluate(
    ({ t, settleFrames }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      const frame = (): number[] => {
        A.renderer.onSeek();
        A.renderFrame(t);
        return A.readPixels().data;
      };
      const same = (a: number[], b: number[]): boolean => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
      };
      let prev = frame();
      let run = 0;
      let n = 1;
      while (n < 80) {
        const cur = frame();
        n++;
        run = same(prev, cur) ? run + 1 : 0;
        prev = cur;
        if (run >= settleFrames - 1) break;
      }
    },
    { t, settleFrames },
  );
}

/**
 * 同一 t 渲两次，返回逐通道差异计数。
 *
 * `clearFeedback`（默认 true）**每次渲前都清一次历史** —— 这正是
 * `determinism.spec.ts` 写明的契约：
 * 「同一历史状态下，同一 t 必须同帧」。
 * 传 false 是在泵历史，那种情况下**不一致是正确行为**，不要拿它当断言。
 *
 * 两次测量之前先 `settle()` —— 否则会被那个一次性过渡打到（实测挂过）。
 */
export async function renderTwiceDiff(page: Page, t: number, clearFeedback = true): Promise<number> {
  await settle(page, t);
  return page.evaluate(
    ({ t, clearFeedback }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      const countDiff = (a: number[], b: number[]): number => {
        let n = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) if (a[i] !== b[i]) n++;
        return n;
      };
      if (clearFeedback) A.renderer.onSeek();
      A.renderFrame(t);
      const a = A.readPixels().data;
      if (clearFeedback) A.renderer.onSeek();
      A.renderFrame(t);
      const b = A.readPixels().data;
      return countDiff(a, b);
    },
    { t, clearFeedback },
  );
}

/** 在指定 t 渲一帧并取像素均值（0–255）。 */
export async function meanAt(page: Page, t: number, clearFeedback = true): Promise<number> {
  return page.evaluate(
    ({ t, clearFeedback }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      if (clearFeedback) A.renderer.onSeek();
      A.renderFrame(t);
      const d = A.readPixels().data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
      return s / (d.length / 4) / 3;
    },
    { t, clearFeedback },
  );
}

/** 在指定 t 渲一帧并取采样哈希（用来断言两个 t 的画面不同）。 */
export async function hashAt(page: Page, t: number, clearFeedback = true): Promise<number> {
  return page.evaluate(
    ({ t, clearFeedback }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      if (clearFeedback) A.renderer.onSeek();
      A.renderFrame(t);
      const d = A.readPixels().data;
      let h = 0;
      for (let i = 0; i < d.length; i += 887) h = (h * 31 + d[i]!) | 0;
      return h;
    },
    { t, clearFeedback },
  );
}

/**
 * 等**异步烘焙落地**。
 *
 * 固定 `waitForTimeout(2500)` 在负载下可能不够 —— 这正是 `algos.spec.ts`
 * 生命游戏那条偶发失败的原因：烘焙在断言中途落地，「缺席 → 在场」被误判成非确定。
 *
 * 从 **Node 侧**轮询（每次之间给 worker 喘息时间）。**不要**在 page 里写忙轮询：
 * 持续的 rAF + readPixels 长任务会把 worker 回包饿死在队列里（实测踩过）。
 */
export async function waitForSourceReady(
  page: Page,
  t: number,
  opts: { minMean?: number; timeoutMs?: number } = {},
): Promise<number> {
  const minMean = opts.minMean ?? 1;
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  let last = 0;
  let stableHits = 0;
  while (Date.now() < deadline) {
    last = await meanAt(page, t);
    stableHits = last > minMean ? stableHits + 1 : 0;
    // 连续两次非空才算就绪：单次命中可能是烘焙落地前后的一帧过渡。
    if (stableHits >= 2) return last;
    await page.waitForTimeout(200);
  }
  return last;
}

/* ------------------------------------------------------------------ 转场 */

export interface TransitionStageSpec {
  /** 出画片段：`[0, cut)`，纯色。 */
  fromColor: string;
  /** 入画片段：`[cut, cut + toDuration)`，紧邻出画片段。 */
  toColor: string;
  /** 剪切点（也是出画片段的 end）。 */
  cut: number;
  toDuration: number;
  /** 转场 id（gl-transitions 的 name）。 */
  defId: string;
  /** 窗口总长。会被 `transitionMaxDuration` 钳制。 */
  duration: number;
  values?: Record<string, number>;
}

export interface TransitionStage {
  track: string;
  fromId: string;
  toId: string;
}

/**
 * 搭一条「两个紧邻纯色片段 + 出画转场」的轨道（关掉 demo 全部轨道）。
 *
 * 转场必须走 `store.setTransitionOut` 而不是直接写工程对象：钳制只有那一处实现，
 * 绕过去测的就是一个用户碰不到的路径。
 *
 * ⚠️ 片段 id **每次调用都不同**。原来写死 `tr-from` 导致同一个页面里调两次时，
 * `ProjectStore.findClip` 返回的是**第一次**那条（已禁用的）轨道上的片段，
 * `setTransitionOut` 就设到了看不见的那一条上 —— 画面里根本没有转场。
 */
let transitionStageSeq = 0;

export async function buildTransitionStage(
  page: Page,
  spec: TransitionStageSpec,
): Promise<TransitionStage> {
  transitionStageSeq += 1;
  const suffix = `-${transitionStageSeq}`;
  return page.evaluate(
    ({ s, suffix }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      const base = {
        fadeSec: 0,
        curves: {},
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
        fit: 'stretch',
      };
      const fromId = `tr-from${suffix}`;
      const toId = `tr-to${suffix}`;

      A.store.commit('e2e: 清空舞台', (p) => {
        for (const t of p.tracks) t.enabled = false;
      });

      const track = A.store.addTrack('visual', `TR${suffix}`);
      A.store.addClip(track, {
        ...base,
        kind: 'source',
        id: fromId,
        start: 0,
        end: s.cut,
        label: 'from',
        source: { type: 'solid', color: s.fromColor },
        blend: 'normal',
        opacity: 1,
      });
      A.store.addClip(track, {
        ...base,
        kind: 'source',
        id: toId,
        start: s.cut,
        end: s.cut + s.toDuration,
        label: 'to',
        source: { type: 'solid', color: s.toColor },
        blend: 'normal',
        opacity: 1,
      });

      A.store.commit('e2e: 启用舞台', (p) => {
        for (const t of p.tracks) t.enabled = t.id === track;
      });

      // 两个片段都在场之后再设转场（它要解析相邻的入画片段）
      A.store.setTransitionOut(fromId, s.defId, s.duration, s.values ?? {});
      return { track, fromId, toId };
    },
    { s: spec, suffix },
  );
}

/** 删掉出画转场（用来断言「转场真的在影响画面」）。 */
export async function clearTransition(page: Page, clipId: string): Promise<void> {
  await page.evaluate((id) => {
    const A = (window as never as { __artmatic: StageApi }).__artmatic;
    A.store.clearTransitionOut(id);
  }, clipId);
}

/**
 * 三通道各自的均值（0–255）。
 *
 * 为什么不能直接用 `meanAt`：把两个**不同颜色**的帧混合时，整帧均值会把
 * 通道差异平均掉 —— 红→蓝在 progress=0.5 处的均值是 (127.5+0+127.5)/3 = 85，
 * 而单通道各自应当是 127.5 / 0 / 127.5。转场断言必须看通道。
 */
export async function rgbMeanAt(
  page: Page,
  t: number,
  clearFeedback = true,
): Promise<[number, number, number]> {
  return page.evaluate(
    ({ t, clearFeedback }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      if (clearFeedback) A.renderer.onSeek();
      A.renderFrame(t);
      const d = A.readPixels().data;
      const sum = [0, 0, 0];
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        sum[0]! += d[i]!;
        sum[1]! += d[i + 1]!;
        sum[2]! += d[i + 2]!;
      }
      return [sum[0]! / n, sum[1]! / n, sum[2]! / n] as [number, number, number];
    },
    { t, clearFeedback },
  );
}

