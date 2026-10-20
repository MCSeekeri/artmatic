import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';
import { ALGO_HEAD, SCENE_GLSL, declaredUniforms } from '../../src/algos/shader-lib';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/**
 * 试炼场（/lab/）的端到端验证。
 *
 * 两条与其它 spec 不同的地方，都是刻意的：
 *
 * 1. **跑的是构建产物里的第二个入口**（`dist/lab/index.html`）。试炼场不是
 *    dev-only 页面 —— 进了 build，才有这条覆盖。顺带证明「双入口 + 静态服务」
 *    这条链路是通的（`/lab/` 的目录索引、`/lab` 的 302 都由它兜底）。
 * 2. **全部断言走 GPU 读回 + 标量归约**，没有一处截图比对：像素在 page 内
 *    reduce 成计数/尺寸，只回传数字。与 determinism.spec.ts / effects.spec.ts
 *    同一套契约（几 MB 的像素数组过界会把 E2E 撑爆）。
 */

interface LabHandle {
  list: () => { sources: string[]; effects: string[] };
  current: () => { sourceId: string; effectId: string | null; bypass: boolean; scale: number; t: number };
  selectSource: (id: string) => void;
  selectEffect: (id: string | null) => void;
  setParam: (scope: 'source' | 'effect', key: string, v: number | string) => void;
  setT: (t: number) => void;
  setScale: (s: number) => void;
  setBypass: (on: boolean) => void;
  setAudioFeatures: (on: boolean) => void;
  renderAt: (t: number, clearFeedback?: boolean) => void;
  readPixels: () => { data: number[]; w: number; h: number };
  renderSize: () => { w: number; h: number };
  /** `dropped` = 声明了但被链接器丢掉的 uniform（= shader 没读过它）。 */
  compileAll: () => { id: string; ok: boolean; error?: string; dropped?: string[] }[];
}

type LabWindow = { __lab?: LabHandle; __artmatic?: unknown };

async function boot(page: Page): Promise<void> {
  // 必须带尾斜杠：`/lab` 走 302 也能到，但那是给人手敲地址用的兜底，
  // 测试直接打规范地址，免得把重定向与页面本身的问题混在一起。
  await page.goto('/lab/');
  // 等装配真的完成（renderSize 非 0），而不是只等钩子挂上 ——
  // 钩子在 mount 之后立刻赋值，而 canvas 的尺寸要等 LabStage 的 onMount。
  await page.waitForFunction(() => {
    const L = (window as unknown as LabWindow).__lab;
    return !!L && L.renderSize().w > 0;
  });
}

/** 像素均值（0–255）。表达式字符串与 effects.spec.ts 同款，在 page 内求值。 */
function meanExpr(): string {
  return `((d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 4) / 3; })`;
}

test('试炼场是独立入口：不引导主应用', async ({ page }) => {
  await boot(page);
  // 主应用把 renderer / store 全挂在 window.__artmatic 上。试炼场里它必须不存在
  // —— 两个入口只共享 render-core 的装配，不共享任何状态。
  const hasMain = await page.evaluate(() => typeof (window as unknown as LabWindow).__artmatic);
  expect(hasMain).toBe('undefined');

  const ids = await page.evaluate(() => (window as unknown as LabWindow).__lab!.list());
  // 源 = 内置测试图 + 算法生成器；特效 = 注册表里的全部。
  expect(ids.sources.length).toBeGreaterThanOrEqual(4);
  expect(ids.effects.length).toBeGreaterThanOrEqual(5);
  expect(ids.sources).toContain('lab:bars');
  expect(ids.sources).toContain('mandelbrot');
  expect(ids.effects).toContain('pixelate');
});

test('渲染出画面，且旁路（看源）与加特效结果不同', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    const mean = eval(meanSrc) as (d: number[]) => number;
    const L = (window as unknown as LabWindow).__lab!;
    L.selectSource('mandelbrot');
    L.selectEffect('pixelate');
    L.setParam('effect', 'size', 24);

    L.setBypass(false);
    L.renderAt(1, true);
    const withFx = L.readPixels().data;
    const withFxMean = mean(withFx);

    L.setBypass(true);
    L.renderAt(1, true);
    const noFx = L.readPixels().data;

    let diff = 0;
    for (let i = 0; i < withFx.length; i++) if (withFx[i] !== noFx[i]) diff++;

    return { withFxMean, diff, px: withFx.length / 4 };
  }, meanExpr());

  // 画面不是全黑（Mandelbrot 在 t=1 就该有内容）。
  expect(result.withFxMean).toBeGreaterThan(1);
  // 旁路真的去掉了特效 —— 同时钉住「特效轨必须排在源轨之前」这条 z 序纪律：
  // 顺序写反的话特效会被源整个盖住，这里的 diff 会是 0。
  expect(result.diff).toBeGreaterThan(0);
});

test('非反馈特效同帧可复现（差异在噪声级内）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.selectSource('mandelbrot');
    L.selectEffect('scanlines');

    /*
     * 预热，跨过**启动窗口**：那段里 GPU 会间歇给出两个稳定态，与「有没有跨帧
     * 状态残留」无关（这条断言要守的是后者）。判据与实测数据见
     * `_stage.ts::renderTwiceStats`。
     */
    for (let k = 0; k < 16; k++) L.renderAt(1.5, true);

    // 先清反馈历史再连渲两次同一 t。清一次、渲两次 —— 第二次不再清，
    // 于是"没有跨帧状态残留"这件事被真的验证到了。
    L.renderAt(1.5, true);
    const a = L.readPixels().data;
    L.renderAt(1.5, false);
    const b = L.readPixels().data;

    let bytes = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) bytes++;
    return { bytes, total: a.length };
  });
  /*
   * 判据是**差异比例**（1%），不是逐字节相等。实测那两个稳定态之间的差异是
   * 0.06%，而真实的跨帧残留是 % 级 —— 见 `_stage.ts::renderTwiceStats` 的表。
   * （`maxDelta` 在这里派不上用场：那个差异的单通道差可到 158，与内容级变化同幅。）
   */
  expect(result.bytes / result.total).toBeLessThan(0.01);
});

test('全部编译：所有特效与实时算法都编得过', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    void meanSrc;
    const L = (window as unknown as LabWindow).__lab!;
    const ids = L.list();
    const results = L.compileAll();
    return {
      results,
      effectCount: ids.effects.length,
      failures: results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error ?? ''}`),
    };
  }, meanExpr());

  // 覆盖率：每个特效都有一条结果（外加 realtime 算法，所以只断言「不少于」）。
  expect(result.results.length).toBeGreaterThanOrEqual(result.effectCount);
  // 「新增一个特效 = 两个文件」纪律下，注册表里的每一个都必须编得过。
  expect(result.failures).toEqual([]);

  /*
   * 「声明了但没被 shader 读过」= 那个参数**拨了没反应**。
   *
   * 判据来自链接器：没被读的 uniform 会被优化掉，`Program.uniforms`（按
   * `ACTIVE_UNIFORMS` 建）里就没有它。这是唯一能自动抓到这一类的地方 ——
   * 伪 GL 的单测看不见（那边的 location 永远有效），而它不报错、不崩、
   * 只是滑杆动画面不动。重构 `menger` 时 `u_twist` 就这么丢过一次。
   *
   * 允许清单**从源码推**（不硬编码）：`ALGO_HEAD` 那批是运行期给所有人的，
   * 某个分形用不到很正常；`SCENE_GLSL` 那批音频/编排 uniform 是**刻意声明的
   * 超集**（见 shader-lib 的注释），但只对 `scene-*` 放行 —— 别的生成器漏读
   * 一个音频 uniform 仍然该失败。
   */
  const headOwned = new Set(declaredUniforms(ALGO_HEAD).keys());
  const sceneShared = new Set(declaredUniforms(SCENE_GLSL).keys());
  const neverRead = result.results
    .filter((r) => r.ok)
    .flatMap((r) =>
      (r.dropped ?? [])
        .filter((n) => !headOwned.has(n) && !(r.id.startsWith('scene-') && sceneShared.has(n)))
        .map((n) => `${r.id}: ${n}`),
    );
  expect(neverRead, '这些 uniform 声明了却没被读过 → 对应参数拨了没反应').toEqual([]);
});

test('右栏标题并排给出显示名与 id（id 不能被 uppercase 改写）', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as unknown as LabWindow).__lab!.selectEffect('neon-edges'));

  // id 是要直接抄进文件名 / i18n 键 / CREDITS 的东西，所以必须原样小写连字符。
  // `.lab-section-title` 上带着 `text-transform: uppercase` 与 0.06em 字距，
  // 漏了在 `.lab-id` 上还原就会显示成 NEON-EDGES —— 看着不出错，抄下来就是错的。
  await expect(page.getByTestId('lab-effect-id')).toHaveText('neon-edges');
  await expect(page.getByTestId('lab-effect-name')).toContainText('霓虹边缘');
});

test('时钟特效：按拍对齐真的接管了相位（speed 归零后相位仍由拍网格给）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    const mean = eval(meanSrc) as (d: number[]) => number;
    const L = (window as unknown as LabWindow).__lab!;
    const shot = (t: number): number[] => {
      L.renderAt(t, true);
      return L.readPixels().data;
    };
    const count = (a: number[], b: number[]): number => {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    };

    // screen-jump 在 intensity=1 时整帧回绕：相位为 0 就是恒等，非 0 必变。
    L.selectSource('mandelbrot');
    L.selectEffect('screen-jump');
    L.setParam('effect', 'intensity', 1);

    // speed = 0 时自由模式的相位恒为 0 —— 这就是「什么都不动」的基线。
    L.setParam('effect', 'sync', 'free');
    L.setParam('effect', 'speed', 0);
    const freeZero = shot(1);

    // LAB_BEAT_GRID = 120bpm / offset 0 → beat(1s) = 2；division 0.25 → 相位 0.5。
    // 与上面那张**完全不同**才算按拍真的接管了 —— 这一条正是回归守卫：
    // 若 u_sync 写不进去（类型不匹配会静默不写），这里会退化成同一个相位 0，
    // 两张图逐像素一致，diff 为 0。
    L.setParam('effect', 'sync', 'beat');
    L.setParam('effect', 'division', '0.25');
    const beatAt1 = shot(1);
    const beatAt15 = shot(1.5);

    return {
      diffFreeVsBeat: count(freeZero, beatAt1),
      diffBeatAcross: count(beatAt1, beatAt15),
      beatMean: mean(beatAt1),
      px: beatAt1.length / 4,
    };
  }, meanExpr());

  // ① 按拍模式与「相位 0」不是同一张图 → u_sync + u_beat 真的接上了。
  expect(result.diffFreeVsBeat).toBeGreaterThan(0);
  // ② 同一个按拍模式下，相位随 t 前进（0.5 → 0.75）→ u_beat 是时间的函数而不是常数。
  expect(result.diffBeatAcross).toBeGreaterThan(0);
  // ③ 不是黑屏 / NaN 雪花 —— 回绕过的 Mandelbrot 仍该有内容。
  expect(result.beatMean).toBeGreaterThan(1);
  expect(result.px).toBeGreaterThan(0);
});

test('pre-pass 的参数真的生效（blur 的 radius 只活在 pre-pass 里）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    const shot = (): number[] => {
      L.renderAt(1, true);
      return L.readPixels().data;
    };
    const count = (a: number[], b: number[]): number => {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    };

    // blur 的 radius **只**在它的两环 pre-pass 里声明，主 pass 一个 uniform 都没有。
    L.selectSource('mandelbrot');
    L.selectEffect('blur');
    L.setParam('effect', 'radius', 0);
    const r0 = shot();
    L.setParam('effect', 'radius', 20);
    const r20 = shot();
    return { diff: count(r0, r20) };
  });

  // runner 若只给主 pass 派发参数，pre-pass 的 u_radius 恒为 0 → 两张图一致。
  // 这条是**唯一**能守住「pre-pass 也要派发参数」的自动关卡 ——
  // effect-uniforms.test.ts 只跑 setUniforms，不经过 runner，看不见这一层。
  expect(result.diff).toBeGreaterThan(0);
});

test('频谱通道：audio-bars 真的被频谱驱动（拍点与拍中的画面不同）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    const shot = (t: number): number[] => {
      L.renderAt(t, true);
      return L.readPixels().data;
    };
    const count = (a: number[], b: number[]): number => {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    };

    // 源必须**时间不变**：`lab:grid` 只吃 uv 与分辨率。
    //
    // 一开始这里用的是 `lab:gradient` —— 它本身随 `u_time` 旋转，于是「把频谱
    // 整个摘掉之后测试仍然通过」，测到的是渐变的旋转而不是柱子。假防线。
    L.selectSource('lab:grid');
    L.selectEffect('audio-bars');
    L.setParam('effect', 'bars', 32);
    L.setParam('effect', 'height', 0.9);
    L.setParam('effect', 'opacity', 1);
    // 关掉平滑：让单帧就能看出差别，而不是要跑一长串帧才显形。
    L.setParam('effect', 'smoothing', 0);

    // 试炼场的合成频谱按 120 bpm 走：1.00 s 是拍点（底鼓），1.25 s 是拍中（踩镲）。
    const onBeat = shot(1);
    L.setBypass(true);
    const bypassed = shot(1);
    L.setBypass(false);
    const offBeat = shot(1.25);

    // **精确不变量**：不透明度 0 → 这个特效必须是恒等的（w = 0 → 输出就是链输入）。
    // 这条能抓住「上传把采样器单元踩掉了」那类 bug：那时 `u_texture` 会被换成
    // 频谱纹理，R8 读出来是 (r,0,0,1)，于是背景变成一片红竖线而不是原图。
    L.setParam('effect', 'opacity', 0);
    const transparent = shot(1);
    L.setParam('effect', 'opacity', 1);

    return {
      drawn: count(onBeat, bypassed),
      driven: count(onBeat, offBeat),
      noop: count(transparent, bypassed),
    };
  });

  // ① 柱子确实画在画面上了。
  expect(result.drawn).toBeGreaterThan(0);
  // ② 而且它的高度来自频谱。这条守的是**整条频谱链路**：
  //    provider → 归一化 → 逐实例平滑 → 纹理 → runner 绑定 u_spectrum。
  //    任何一环断了，频谱恒为静音 → 每根柱子都是空的 → 两张图一致。
  expect(result.driven).toBeGreaterThan(0);
  // ③ 贡献为 0 时不许动画面（逐像素完全一致）。
  expect(result.noop).toBe(0);
});

test('音频特征通道：场景生成器真的被特征驱动（同一 t 摘掉特征源画面必须不同）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    const mean = eval(meanSrc) as (d: number[]) => number;
    const L = (window as unknown as LabWindow).__lab!;
    const shot = (t: number): number[] => {
      L.renderAt(t, true);
      return L.readPixels().data;
    };
    const count = (a: number[], b: number[]): number => {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    };

    L.selectSource('scene-ripple');
    L.selectEffect(null);
    // t = 1 s 落在拍点上（120 bpm → 每 0.5 s 一拍）。
    const withAudio = shot(1);

    // 摘掉特征源：**同一 t、同一参数**，唯一的差别是音频特征。
    //
    // 这条守的是**整条特征链路**：lab 合成特征 → render-core 注入 →
    // `AlgoRuntime.at()` → `ctx.features` → `sceneUniforms()` 写
    // u_rms / u_sub / u_ages / u_travel → 场景 shader。
    // 任何一环断了（漏传 `features`、漏写某个 uniform、运行期没读源），
    // 两张图会逐像素一致 —— 而表现形式只是「画面偏暗」，完全不报错。
    L.setAudioFeatures(false);
    const noAudio = shot(1);
    L.setAudioFeatures(true);
    const restored = shot(1);

    return {
      driven: count(withAudio, noAudio),
      restoredDiff: count(withAudio, restored),
      mean: mean(withAudio),
      px: withAudio.length / 4,
    };
  }, meanExpr());

  // ① 特征确实进了画面。
  expect(result.driven).toBeGreaterThan(0);
  // ② 装回来之后与第一次逐像素一致 —— 特征读取是**无状态**的（纯 t 的函数），
  //    开关切换不污染后续帧。硬约束 1.1 在特征链路上的落实。
  expect(result.restoredDiff).toBe(0);
  // ③ 不是黑屏 / NaN 雪花。
  expect(result.mean).toBeGreaterThan(0.5);
  expect(result.px).toBeGreaterThan(0);
});

test('试炼场播放时把渲染节流到 LAB_FPS（反馈类特效按渲染帧累积状态）', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const L = (window as unknown as LabWindow).__lab! as unknown as {
      play(on: boolean): void;
      current(): { fps: number };
    };
    L.play(true);
    // 等读数刷新（它每 500 ms 重算一次）
    await new Promise((res) => setTimeout(res, 1600));
    const fps = L.current().fps;
    L.play(false);
    return { fps };
  });

  // 反馈类特效每个 pass 只在渲染时步进一次，而 u_delta 是名义 1/fps ——
  // 渲染率必须等于工程帧率，否则仿真会随时间轴漂（预览跑满 rAF 60 而
  // LAB_FPS=30 → 仿真快一倍，不稳定模拟直接表现成「狂闪」）。
  expect(r.fps).toBeGreaterThan(10);
  expect(r.fps).toBeLessThan(48);
});

test('delayedInput：datamosh 的运动估计真的用到了「上一帧输入」', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    const count = (a: number[], b: number[]): number => {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    };
    /** 从干净状态跑 N 帧，返回最后一帧。 */
    const run = (velocity: number): number[] => {
      L.setParam('effect', 'velocity', velocity);
      L.renderAt(1, true); // 清反馈：两次跑必须从同一状态出发
      let last: number[] = [];
      for (let i = 1; i <= 8; i += 1) {
        L.renderAt(1 + i / 30, false);
        last = L.readPixels().data;
      }
      return last;
    };

    // 源必须**随时间变**：运动估计是「当前帧 − 上一帧输入」的差分，
    // 源不动的话 l0 − lp 恒为 0，探针就没信号了。
    L.selectSource('lab:gradient');
    L.selectEffect('kino-datamosh');
    const still = run(0);
    const moving = run(4);
    return { diff: count(still, moving) };
  });

  // `velocity` 只乘运动矢量。若 `delayedInput` 没把上一帧输入接上，
  // l0 − lp 恒为 0 → mv 恒为 0 → 两次跑会**逐像素完全一致**（连 DCT 噪声都一样，
  // 因为 d.z 只依赖 mvLen）。所以这条断言恰好只在它真的接上时成立。
  expect(result.diff).toBeGreaterThan(0);
});

test('分辨率档位真的改后备缓冲尺寸（不被显示区压掉）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.setScale(1);
    const full = L.renderSize();
    L.setScale(0.5);
    const half = L.renderSize();
    L.setScale(0.25);
    const quarter = L.renderSize();
    return { full, half, quarter };
  });

  // 这一条专门守 `fitPreviewSize` 那个坑：它的 `k = Math.min(1, scale)`
  // 只缩不放，中间舞台列比 1280 窄，所以若不用 setExportSize 钉死后备缓冲，
  // 100% 档会被悄悄缩成一半、三档全都"看起来一样小"。
  expect(result.full.w).toBe(1280);
  expect(result.full.h).toBe(720);
  expect(result.half.w).toBe(640);
  expect(result.half.h).toBe(360);
  expect(result.quarter.w).toBe(320);
  expect(result.quarter.h).toBe(180);
});

test('内置测试图接进了源链路，且彼此不同', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.selectEffect(null); // 只看源
    L.selectSource('lab:bars');
    L.renderAt(0, true);
    const bars = L.readPixels().data;

    L.selectSource('lab:grid');
    L.renderAt(0, true);
    const grid = L.readPixels().data;

    L.selectSource('lab:gradient');
    L.renderAt(0, true);
    const grad = L.readPixels().data;

    let barsGrid = 0;
    let barsGrad = 0;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i] !== grid[i]) barsGrid++;
      if (bars[i] !== grad[i]) barsGrad++;
    }
    return { barsGrid, barsGrad, len: bars.length };
  });

  expect(result.len).toBeGreaterThan(0);
  // 三张图为不同的画面 → 测试图确实经过 resolver 拦截渲进了合成链路，
  // 而不是都落到 SourceManager 的 `default: return null`（那样三张全黑、diff 为 0）。
  expect(result.barsGrid).toBeGreaterThan(0);
  expect(result.barsGrad).toBeGreaterThan(0);
});

test('悬停提示气泡真的浮出来（Tip 的渲染者在 lab 里也要挂上）', async ({ page }) => {
  await boot(page);

  /*
   * `use:tip` 只是**写状态**：文字进 tooltip store，气泡本体是根级的 `<Tip />`。
   * 试炼场是独立入口、不引主应用，主应用那份 `<Tip />`（App.svelte 根部）不会
   * 跟着过来 —— 有一阵子 rail 上所有 `tipText` 悬停都没反应，页面也不报错，
   * 因为「没有人渲染气泡」在 DOM 上什么痕迹都不留。
   *
   * 期望文字从**文案表**取，不写中文字面量：改一句文案不该让这条变红。
   */
  const compileTip = zhCN['lab.compileAllTip'];
  const bubble = page.getByTestId('tip-bubble');

  // 气泡有 350ms 延迟（TIP_DELAY_MS），用 expect 的轮询等它。
  await page.getByTestId('lab-rail-compile').hover();
  await expect(bubble).toBeVisible();
  // 断的必须是 tipText 而不是 label —— 把两者弄混（退化成 aria-label）也是错的。
  await expect(bubble).toHaveText(compileTip);
  expect(compileTip).not.toBe(zhCN['lab.compileAll']);

  // 指针移开就收起：气泡不残留。
  await page.getByTestId('lab-canvas').hover();
  await expect(bubble).toBeHidden();
});

/**
 * 液晶屏的子像素只能发自己那一通道。
 *
 * 曾经的做法是 `mix(白, chan * 3, 0.5)`：拿一层白色底光把「子像素只占 1/3 宽度
 * 所以要亮 3 倍」这件事摊到三根竖条上。亮度好看了，物理上是胡话 —— 红子像素
 * 跟着发绿，纯绿画面变成三根绿条（GGG），纯青变成青 / 绿 / 蓝三色条。
 *
 * 判据一：**一个像素里不许同时有两个通道亮着**。子像素只透自己那一通道，
 * 所以每颗输出像素要么落在某根竖条上（单通道），要么落在黑矩阵里。掺白底时
 * 白色像素是 `(1, .5, .5)`、中灰是 `(1, .25, .25)` —— 阈值 40（≈16%）卡在
 * 那 0.25 之下、噪声之上。
 *
 * 判据二**必须按位置量**，不能只看像素里的通道数：纯饱和色下掺白底不改变
 * 通道数（绿条里那两根错色的竖条输出 `(0, .5, 0)`，仍是单通道，只是颜色错位）。
 * 所以另取绿条（`lab:bars` 的第 4 条，正中间，翻转不影响）量两件事：
 * 红 / 蓝子像素的均值必须近 0，且**亮像素只占约三分之一**（三根竖条里只有
 * 中间那根亮）。实测：正确实现 0.26，掺白底 0.57。
 */
test('液晶屏：子像素只发自己那一通道', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.selectSource('lab:bars');
    L.selectEffect('lcd');
    // 反光与坏道都会往画面上加白 / 加彩，与这条要守的东西无关。
    L.setParam('effect', 'glare', 0);
    L.setParam('effect', 'broken', 0);
    // distance = 1 ⇒ zoom = 1：屏幕坐标与内容坐标重合，条带位置不用再换算。
    L.setParam('effect', 'distance', 1);
    L.setParam('effect', 'pitch', 8);
    L.renderAt(0, true);

    const { data, w, h } = L.readPixels();
    let mixed = 0; // 同一像素里 ≥2 个通道亮着
    const green = [0, 0, 0]; // 绿条的三通道均值
    let band = 0;
    let lit = 0;
    // 让开两条交界（格子跨过色块边界时，抽头会把两种颜色平均进来）。
    const gx0 = Math.floor((3 * w) / 7) + Math.ceil(8);
    const gx1 = Math.floor((4 * w) / 7) - Math.ceil(8);
    for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.7); y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const rr = data[i]!;
        const gg = data[i + 1]!;
        const bb = data[i + 2]!;
        if ((rr > 40 ? 1 : 0) + (gg > 40 ? 1 : 0) + (bb > 40 ? 1 : 0) >= 2) mixed++;
        if (x >= gx0 && x < gx1) {
          green[0]! += rr;
          green[1]! += gg;
          green[2]! += bb;
          if (Math.max(rr, gg, bb) > 40) lit++;
          band++;
        }
      }
    }
    return { mixed, litRatio: lit / band, mean: green.map((s) => s / band / 255) as number[] };
  });

  expect(r.mixed, '子像素串色：一个像素里有两根子像素在发不同颜色的光').toBe(0);
  // 绿条只有中间那根竖条该亮 → 亮像素约等于发光面积的三分之一。
  expect(r.litRatio, '绿条的亮像素接近全亮 → 红、蓝子像素也在发绿（GGG）').toBeLessThan(0.45);
  const [mr, mg, mb] = r.mean as [number, number, number];
  // 正向：绿子像素真的亮着（否则「输出全黑」也能通过）。
  expect(mg, '绿条不亮了').toBeGreaterThan(0.1);
  expect(mr, '红子像素在发绿光').toBeLessThan(mg * 0.05);
  expect(mb, '蓝子像素在发绿光').toBeLessThan(mg * 0.05);
});
