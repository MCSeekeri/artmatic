/**
 * 3D 生成器家族（`sdf-lib.ts` 内核）的契约守卫。
 *
 * 内核带来一种新的失败形态：**内核与生成器各写一半，缺的那一半是静默的**。
 * 三个例子，都是真实踩过的：
 *
 * - 内核里调 `sdX(...)` 而生成器把 `sdX` 定义在拼在**后面**的字符串里 ——
 *   GLSL 要求先声明后使用，报错行号却指向内核，看着像内核写错了。
 * - 生成器声明了 `u_twist` 却忘了在 SDF 里读它 —— uniform 被链接器丢掉、
 *   参数拨了没反应（这条由 `lab.spec` 的「声明了却没被读过」兜，因为只有
 *   真 GL 的 `ACTIVE_UNIFORMS` 看得见）。
 * - `sdfParams()` 被展开两次 / 生成器自己又写了一个 `color` —— 参数表里出现
 *   同名键，UI 上两个滑杆绑同一个键，拖动互相打架。
 *
 * 这里守的是**静态可判**的那几条。
 */

import { describe, expect, it } from 'vitest';
import { listGenerators, getGenerator } from '../../src/algos/registry';
import { SDF_CAMERAS, SDF_PALETTES, SDF_TONEMAPS, sdfKernel, sdfParams } from '../../src/algos/sdf-lib';

/** 判定一个生成器是不是走 3D 内核 —— 内核的标志是那段共享的步进函数。 */
const usesKernel = (fragment: string): boolean => fragment.includes('sdfMarch(');

const REALTIME = listGenerators()
  .map((g) => getGenerator(g.id)!)
  .filter((d) => d.kind === 'realtime');

const THREED = REALTIME.filter((d) => usesKernel((d as { fragment: string }).fragment));

describe('3D 内核家族', () => {
  it('覆盖面自检：至少有三个生成器走内核（否则下面全是空转）', () => {
    expect(THREED.map((d) => d.id).sort()).toEqual(['apollonian', 'mandelbulb', 'menger']);
  });

  it.each(THREED.map((d) => d.id))('%s：内核为它定义的 SDF 提供了前向声明', (id) => {
    const frag = (getGenerator(id) as { fragment: string }).fragment;
    // 生成器那一半里的定义：`float sdX(vec3 p) {`
    const def = /float\s+(sd\w+)\s*\(\s*vec3\s+p\s*\)\s*\{/.exec(frag);
    expect(def, `${id} 里找不到形如 float sdX(vec3 p) { 的 SDF 定义`).not.toBeNull();
    const name = def![1]!;
    expect(
      frag.includes(`float ${name}(vec3 p);`),
      `${id} 的 fragment 里没有 \`float ${name}(vec3 p);\` 这句前向声明 —— ` +
        'GLSL 会报 no matching overloaded function，而报错行指向内核',
    ).toBe(true);
    // 声明必须来自内核模板（拼接顺序错了就会漏）
    expect(sdfKernel(name)).toContain(`float ${name}(vec3 p);`);
  });

  it.each(THREED.map((d) => d.id))('%s：共用参数的键不重复（展开两次就会打架）', (id) => {
    const keys = getGenerator(id)!.params.map((p) => p.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes, `${id} 的参数表里有重复键 → 两个控件绑同一个值`).toEqual([]);
  });

  it.each(THREED.map((d) => d.id))('%s：共用参数一个不少', (id) => {
    const keys = new Set(getGenerator(id)!.params.map((p) => p.key));
    const required = sdfParams().map((p) => p.key);
    expect(required.filter((k) => !keys.has(k)), `${id} 缺共用参数`).toEqual([]);
  });

  it('共用参数是按「同一套键 + 同一套文案」给的（不再一个生成器一份）', () => {
    const shared = sdfParams();
    for (const def of THREED) {
      for (const p of def.params) {
        const ref = shared.find((s) => s.key === p.key);
        if (!ref) continue;
        // menger 的 steps/fog/ao 默认值刻意不同（保住上游画面），但**文案键必须同源**，
        // 否则「最远距离」会以几种措辞出现在界面上。
        expect(p.labelKey, `${def.id}.${p.key} 的文案键与共用参数不一致`).toBe(ref.labelKey);
      }
    }
  });

  it('调色板的选项值都在映射表里（拼错就是静默退回单色）', () => {
    for (const def of THREED) {
      const pal = def.params.find((p) => p.key === 'palette');
      expect(pal, `${def.id} 没有 palette`).toBeDefined();
      if (pal?.type !== 'select') throw new Error(`${def.id} 的 palette 不是 select`);
      for (const o of pal.options) {
        expect(SDF_PALETTES[String(o.value)], `${def.id}: palette 选项 ${o.value} 没有映射`).toBeDefined();
      }
    }
  });

  it('`dual` 保留成 height 的别名 —— 老工程里的 menger 用的是这个名字', () => {
    // 参数值按字符串存进工程 JSON：删掉别名，老工程会静默退回单色。
    expect(SDF_PALETTES['dual']).toBe(SDF_PALETTES['height']);
  });

  it('tonemap 的选项值都在映射表里（拼错就是静默退回线性）', () => {
    for (const def of THREED) {
      const p = def.params.find((q) => q.key === 'tonemap');
      expect(p, `${def.id} 没有 tonemap`).toBeDefined();
      if (p?.type !== 'select') throw new Error(`${def.id} 的 tonemap 不是 select`);
      for (const o of p.options) {
        expect(SDF_TONEMAPS[String(o.value)], `${def.id}: tonemap 选项 ${o.value} 没有映射`).toBeDefined();
      }
    }
  });

  it('着色模型的每个 uniform 都被内核真的读到（声明了不读 = 链接器丢掉 + 滑杆空转）', () => {
    /*
     * 真 GL 那条判据在 `lab.spec`（`ACTIVE_UNIFORMS` 的差集），但它要起浏览器。
     * 这条是它的毫秒级前置：声明 1 次 + 在函数体里至少出现 1 次。
     * 不覆盖「写了但类型错」—— 那是 `algo-uniforms.test.ts` 的事。
     */
    const k = sdfKernel('sdX');
    for (const n of [
      'u_shadowSteps',
      'u_shadow',
      'u_gloss',
      'u_ambient',
      'u_pointPos',
      'u_pointPow',
      'u_pointCol',
      'u_fogCol',
      'u_tonemap',
    ]) {
      const hits = k.match(new RegExp(`\\b${n}\\b`, 'g')) ?? [];
      expect(hits.length, `${n} 在核心里只被声明、没有被读`).toBeGreaterThan(1);
    }
  });

  it('镜头模式的选项值都在映射表里，且缺省是环绕（老工程没有 camera 键）', () => {
    const withCamera = THREED.filter((d) => d.params.some((p) => p.key === 'camera'));
    expect(withCamera.map((d) => d.id).sort(), '穿梭镜头至少要装在两个生成器上').toEqual([
      'apollonian',
      'menger',
    ]);
    for (const def of withCamera) {
      const p = def.params.find((q) => q.key === 'camera')!;
      if (p.type !== 'select') throw new Error(`${def.id} 的 camera 不是 select`);
      for (const o of p.options) {
        expect(SDF_CAMERAS[String(o.value)], `${def.id}: camera 选项 ${o.value} 没有映射`).toBeDefined();
      }
      // 缺省必须是 orbit：新参数在老工程里没有键，取默认值不能让取景变掉
      expect(p.defaultValue).toBe('orbit');
    }
    expect(SDF_CAMERAS.orbit).toBe(0);
  });

  it('「无限延伸」只挂在三维海绵下，缺省是单体', () => {
    const menger = getGenerator('menger')!;
    const p = menger.params.find((q) => q.key === 'extent');
    expect(p, 'menger 没有 extent').toBeDefined();
    if (p?.type !== 'select') throw new Error('menger 的 extent 不是 select');
    expect(p.defaultValue).toBe('bounded');
    // 地毯（挤出）不是「无限延伸」的候选：铺满空间只是一块挖了洞的墙
    const visible = p.visibleWhen as unknown as (v: Record<string, unknown>) => boolean;
    expect(visible({ variant: 'carpet' })).toBe(false);
    expect(visible({ variant: 'sponge' })).toBe(true);
    // 其余两个分形不该有这一项
    for (const id of ['mandelbulb', 'apollonian']) {
      expect(getGenerator(id)!.params.some((q) => q.key === 'extent'), `${id} 混进了 extent`).toBe(false);
    }
  });

  it('无限模式里不许残留外框约束（会在折叠后的 cell 边界上造出假表面）', () => {
    /*
     * max(|p|) - 1 在折叠坐标里恒 ≤ 0，看着无害，但它在 |p| = 1 那一圈恰好是 0
     * ⇒ 整张 cell 边界都满足 d < eps ⇒ 步进在边界附近立刻判成命中，画面变成
     * 一块纯色；镜头正好落在边界上时命中距离为 0，被调用点的旧写法当成没命中
     * ⇒ 整帧全黑。两个症状都不报错，只能靠「换几个时刻都是黑的」发现。
     */
    const frag = (getGenerator('menger') as { fragment: string }).fragment;
    expect(frag).toMatch(/bool inf = u_extent == 1 && u_variant == 0;/);
    expect(frag, '无限分支必须把 d 的初值设成「无约束」而不是 max(|p|)-1').toMatch(
      /float d = -1\.0e6;/,
    );
  });

  it('穿梭镜头的倾角缺省是 0（老工程没这个键，非零缺省会让所有穿梭带倾斜开场）', () => {
    for (const id of ['menger', 'apollonian']) {
      const p = getGenerator(id)!.params.find((q) => q.key === 'flyTilt');
      expect(p, `${id} 没有 flyTilt`).toBeDefined();
      expect(p!.defaultValue).toBe(0);
    }
  });

  it('球堆只在 XZ 平面里飞（竖直段整屏是纯色）', () => {
    /*
     * 这是用户实际报上来的第二个问题：Menger 的「三轴全开」被直接套给了球堆，
     * 于是镜头偶尔朝上/朝下飞 —— 而球堆的头顶脚下是一整片纯色，那几秒画面
     * 什么都没有。轴数由 sdfFlyCam 的第 6 个实参决定。
     */
    const apoll = (getGenerator('apollonian') as { fragment: string }).fragment;
    expect(apoll, 'apollonian 必须传 axes = 2').toMatch(/sdfFlyCam\([^;]*,\s*2,\s*vec3/);
    const menger = (getGenerator('menger') as { fragment: string }).fragment;
    expect(menger, 'menger 六向全开，传 axes = 3').toMatch(/sdfFlyCam\([^;]*,\s*3,\s*vec3/);
  });

  it('软阴影的步长上界按 maxt 的比例夹，不按 mint 夹', () => {
    /*
     * 踩过的坑：`clamp(h * stepScale, mint * 0.5, mint * 8.0)`。
     * mint 是命中容差的 2 倍（近景只有几毫），乘 8 之后 12 步总共走不到一个单位，
     * 阴影射线还没到遮挡物就烧完了步数 —— 表现是「开了阴影画面几乎不变」，
     * 而且不报错。E2E 那条 `mean 比 < 0.97` 是它的最终防线，这条让它更难回来。
     */
    const k = sdfKernel('sdX');
    expect(k).not.toMatch(/mint \* 8\.0/);
    expect(k).toMatch(/maxt \* 0\.1/);
  });

  it('内核不自带相机调用 —— 相机由生成器自己决定（menger 保上游取景）', () => {
    // sdfOrbitCam / sdfCam / sdfRay 都是**可选**工具，内核本身不替生成器取景。
    // 这条钉住的是「内核不知道任何具体生成器的参数名」：一旦内核里出现
    // u_push / u_dist 这类具体参数，它就不再是内核了。
    expect(sdfKernel('sdX')).not.toMatch(/u_push|u_dist|u_yaw|u_pitch|u_iter|u_scale/);
  });
});
