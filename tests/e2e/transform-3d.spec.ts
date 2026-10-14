import { expect, test, type Page } from '@playwright/test';
import { openDemo, rgbaAt, setTrackEnabled, settle } from './_stage';

/**
 * transform-3d（「3D 变换」）与下层 blend 的回归守卫。
 *
 * 用户报告：「特效『3D 变换』会让下方片段的合成模式无效化。」
 *
 * 静态分析给出的两个候选（这里独立核对，不照抄）：
 *   A. **真有 bug**：特效链在时序上抹掉了下面已经做过的 blend。
 *   B. **几何被裁**：`edge='none'`（默认）把旋转平面之外输出成全透明，
 *      于是画面不再铺满 ⇒ 用户看着「下层那层没了 / 混合不对了」。
 *
 * 合成时序（`engine/stack.ts` / `engine/compositor.ts`）：effect 是 adjustment
 * layer，它在 `runOps` 的循环里**位于**两条 source op 之后，读到的 `u_texture`
 * 就是 `acc` —— 两份源**已经 blend 完**的结果。所以 A 在时序上不成立，
 * 现象应当落在 B 上。这条 spec 用**分通道的实测 RGB**把两件事分开：
 *
 *   1. 平面内（画面正中，必定落在旋转平面里）：加特效前后逐通道一致，
 *      且 screen 配方是品红（R、B 高 G 低）、normal 配方是蓝（R 低 B 高）
 *      —— 说明中心这一点上 blend 结果原样保留。
 *   2. 「有 transform-3d 时，blend=screen 与 blend=normal 是否仍给出不同结果」：
 *      仍不同 ⇒ blend 没被抹掉（判据是分通道 L1，不是亮度）。
 *   3. 平面外（左上角，旋转后落到画幅之外）：加特效后变黑、不加特效是品红
 *      —— 这条同时证明「特效真的在跑」（否则 1、2 会在一个 no-op 上假通过）
 *      并给出用户实际看到的退化。
 *
 * 底图刻意用高饱和纯色（screen(red, blue) = 品红，一眼区别于 blue），
 * 判据取分通道 L1 / 单通道标量（AGENTS §6.1），不压成亮度。
 *
 * ## 实测（本机 Chrome，默认参数 rotY=25 / edge='none' / zoom=1）
 *
 * | 探针 | 有 transform-3d | 无 transform-3d |
 * |---|---|---|
 * | 中心 (0.5,0.5)，V2=screen | `[255,0,255]`（品红） | `[255,0,255]`（品红） |
 * | 中心 (0.5,0.5)，V2=normal | `[0,0,255]`（蓝） | — |
 * | 左上角 (0.02,0.02)，V2=screen | `[0,0,0]`（黑，平面外） | `[255,0,255]`（品红） |
 *
 * ⇒ 中心加特效前后逐通道 **L1 = 0**；screen 与 normal 在有特效时 R 通道差 **255**
 * —— **blend 没有被抹掉**。用户看到的是「左上角等平面外区域被裁成透明」。
 * `edge='clamp'` 时左上角落回 `[0,0,255]`（蓝，边缘像素铺满）⇒ 画幅重新填满。
 */

interface BlendStage {
  belowTrack: string;
  aboveTrack: string;
  fxTrack: string;
}

/** `window.__artmatic` 里本 spec 用到的部分（回调里就地写，见 _stage.ts 头注）。 */
interface StageApi {
  store: {
    addTrack: (kind: 'visual', name?: string) => string;
    addClip: (trackId: string, clip: unknown) => void;
    commit: (label: string, fn: (p: { tracks: { id: string; enabled: boolean; clips: unknown[] }[] }) => void) => void;
  };
  renderer: { onSeek: () => void };
  renderFrame: (t: number) => void;
  readPixels: () => { data: number[]; w: number; h: number };
}

const RED = '#ff0000';
const BLUE = '#0000ff';

/**
 * 搭一条「V1 纯红 normal（底下）/ V2 纯蓝（blend 可配，压在上面）/ transform-3d（最上层）」
 * 的三轨干净栈。
 *
 * 与 `_stage.ts::buildStage` 同一套纪律：关掉 demo 全部轨道、只启用自己这三条、
 * 特效必须在源之上。这里是内联而不是复用 `buildStage`，因为后者只支持**单个**源，
 * 而本用例的关键恰恰是「源 A 与源 B 之间有 blend」。
 *
 * z 序 = 列表位置取反（`tracks[0]` 是最前景），所以排轨顺序必须是 FX → V2 → V1。
 */
async function buildBlendStage(page: Page, blend: string): Promise<BlendStage> {
  return page.evaluate(
    ({ blend }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      const base = {
        fadeSec: 0,
        curves: {},
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
        fit: 'stretch',
      };

      A.store.commit('e2e: 清空舞台', (p) => {
        for (const t of p.tracks) t.enabled = false;
      });

      const belowTrack = A.store.addTrack('visual', 'V1');
      const aboveTrack = A.store.addTrack('visual', 'V2');
      const fxTrack = A.store.addTrack('visual', 'FX');

      A.store.addClip(belowTrack, {
        ...base,
        kind: 'source',
        id: 'v1',
        start: 0,
        end: 8,
        label: 'v1',
        source: { type: 'solid', color: '#ff0000' },
        blend: 'normal',
        opacity: 1,
      });
      A.store.addClip(aboveTrack, {
        ...base,
        kind: 'source',
        id: 'v2',
        start: 0,
        end: 8,
        label: 'v2',
        source: { type: 'solid', color: '#0000ff' },
        blend,
        opacity: 1,
      });
      A.store.addClip(fxTrack, {
        ...base,
        kind: 'effect',
        id: 'fx3d',
        start: 0,
        end: 8,
        label: 'fx3d',
        // values 留空 ⇒ runner 回落 defaultValue（rotY=25、edge='none'、zoom=1 …）
        chain: [{ instanceId: 'fx3d-i', defId: 'transform-3d', enabled: true, values: {} }],
      });

      // 排轨：前景到背景 = FX → V2 → V1（addTrack 是 push，新轨 z 最低）。
      A.store.commit('e2e: 排轨', (p) => {
        const order = [fxTrack, aboveTrack, belowTrack];
        const pick = (id: string) => p.tracks.find((t) => t.id === id)!;
        const rest = p.tracks.filter((t) => !order.includes(t.id));
        p.tracks = [...order.map(pick), ...rest];
      });
      A.store.commit('e2e: 启用舞台', (p) => {
        for (const t of p.tracks) t.enabled = t.id === fxTrack || t.id === aboveTrack || t.id === belowTrack;
      });

      return { belowTrack, aboveTrack, fxTrack };
    },
    { blend },
  );
}

/** 把 V2 的 blend 改成 `blend`（走 store 的正规入口）。 */
async function setAboveBlend(page: Page, trackId: string, blend: string): Promise<void> {
  await page.evaluate(
    ({ trackId, blend }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      A.store.commit('e2e: 改 blend', (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        const clip = (track?.clips as { id: string; blend: string }[] | undefined)?.find((c) => c.id === 'v2');
        if (clip) clip.blend = blend;
      });
    },
    { trackId, blend },
  );
}

/** 把特效实例的 edge 改成 `edge`（用来验证「换个更直觉的 edge 能填满画幅」）。 */
async function setEdge(page: Page, trackId: string, edge: string): Promise<void> {
  await page.evaluate(
    ({ trackId, edge }) => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      A.store.commit('e2e: 改 edge', (p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        const clip = (track?.clips as { chain?: { values: Record<string, unknown> }[] }[] | undefined)?.[0];
        const inst = clip?.chain?.[0];
        if (inst) inst.values.edge = edge;
      });
    },
    { trackId, edge },
  );
}

/** 分通道 L1（0 = 三通道全同）。不压成亮度 —— 见 AGENTS §6.1 / `_stage.ts::GridStats.samples`。 */
function l1(a: readonly number[], b: readonly number[]): number {
  return Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!);
}

/** 画面正中：必定落在旋转平面内（中心像素反向投射回 (0.5,0.5)）。 */
const CENTER: [number, number] = [0.5, 0.5];
/** 左上角：绕 Y 轴 25° 后落到画幅之外（左边 / 上边被裁掉），是「几何被裁」的探针。 */
const CORNER: [number, number] = [0.02, 0.02];

test('transform-3d 不抹掉下层 blend；中心分通道一致，screen/normal 仍可分', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildBlendStage(page, 'screen');
  await settle(page, 1);

  // ① 有特效（默认参数）时的中心与角落
  const centerScreenFx = await rgbaAt(page, 1, CENTER[0], CENTER[1]);
  const cornerScreenFx = await rgbaAt(page, 1, CORNER[0], CORNER[1]);

  // ② 关掉特效轨拿基线
  await setTrackEnabled(page, stage.fxTrack, false);
  const centerScreenNoFx = await rgbaAt(page, 1, CENTER[0], CENTER[1]);
  const cornerScreenNoFx = await rgbaAt(page, 1, CORNER[0], CORNER[1]);
  await setTrackEnabled(page, stage.fxTrack, true);

  // ③ 把 V2 换成 normal（其余不变），再量中心
  await setAboveBlend(page, stage.aboveTrack, 'normal');
  const centerNormalFx = await rgbaAt(page, 1, CENTER[0], CENTER[1]);

  /* ------------------------------------------------ 基线自检（防空转） */

  // 无特效时：screen(red, blue) = 品红。没有这条，后面「中心一致」可能是两张黑图。
  expect(
    cornerScreenNoFx[0]! > 180 && cornerScreenNoFx[2]! > 180 && cornerScreenNoFx[1]! < 80,
    `无特效时角落应是 screen 出来的品红，实测 ${cornerScreenNoFx.join(',')}`,
  ).toBe(true);
  // 无特效时中心同样是品红
  expect(centerScreenNoFx[0]! > 180 && centerScreenNoFx[2]! > 180, `无特效中心应是品红，实测 ${centerScreenNoFx.join(',')}`).toBe(true);

  /* ---------------------------------- 1) 平面内：加特效前后逐通道一致 */

  // 中心 (0.5,0.5) 反向投射回 (0.5,0.5)，落在纯色源上 ⇒ RGB 应与无特效逐通道相同。
  // ≤3 是给 GPU 量化 / LINEAR 采样留的余量（纯色场理论上是 0）。
  expect(
    l1(centerScreenFx, centerScreenNoFx),
    `平面内中心加了 transform-3d 后 blend 结果不应改变：有 ${centerScreenFx.join(',')} vs 无 ${centerScreenNoFx.join(',')}`,
  ).toBeLessThanOrEqual(3);
  expect(centerScreenFx[0]! > 180 && centerScreenFx[2]! > 180, `有特效中心仍是品红，实测 ${centerScreenFx.join(',')}`).toBe(true);

  /* ------------------- 2) blend 未被抹掉：screen 与 normal 仍给出不同结果 */

  // screen 中心 = 品红（R、B 高），normal 中心 = 蓝（R 低、B 高）。
  expect(centerNormalFx[2]! > 180, `normal 中心应是蓝的，实测 ${centerNormalFx.join(',')}`).toBe(true);
  expect(centerNormalFx[0]! < 60, `normal 中心不应有红分量，实测 ${centerNormalFx.join(',')}`).toBe(true);
  // 分通道 L1：R 通道的差异就是「blend 生效」的直接证据（品红 vs 蓝只差 R）。
  expect(
    Math.abs(centerScreenFx[0]! - centerNormalFx[0]!),
    `有 transform-3d 时 screen 与 normal 必须仍不同（否则 blend 被抹掉）：screen ${centerScreenFx.join(',')} vs normal ${centerNormalFx.join(',')}`,
  ).toBeGreaterThan(150);
  expect(l1(centerScreenFx, centerNormalFx)).toBeGreaterThan(150);

  /* --------------------- 3) 平面外：几何被裁 ⇒ 用户实际看到的现象 */

  // 左上角落在旋转平面之外（edge='none' 默认）⇒ 透明 ⇒ 黑。
  expect(
    cornerScreenFx[0]! + cornerScreenFx[1]! + cornerScreenFx[2]!,
    `左上角应在旋转平面之外（默认 edge='none'）而变黑，实测 ${cornerScreenFx.join(',')}`,
  ).toBeLessThan(60);
  // 而关掉特效时它是品红（= ② 已经量过）—— 两条合起来证明特效确实在跑。

  /* ------------------- 4) 换 edge='clamp' 能把画幅重新填满（建议的依据） */

  await setEdge(page, stage.fxTrack, 'clamp');
  const cornerClampFx = await rgbaAt(page, 1, CORNER[0], CORNER[1]);
  expect(
    cornerClampFx[0]! + cornerClampFx[1]! + cornerClampFx[2]!,
    `edge='clamp' 时角落应被边缘像素填满而不是透明，实测 ${cornerClampFx.join(',')}`,
  ).toBeGreaterThan(180);
});
