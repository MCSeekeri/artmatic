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
import { SDF_PALETTES, sdfKernel, sdfParams } from '../../src/algos/sdf-lib';

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

  it('内核不自带相机调用 —— 相机由生成器自己决定（menger 保上游取景）', () => {
    // sdfOrbitCam / sdfCam / sdfRay 都是**可选**工具，内核本身不替生成器取景。
    // 这条钉住的是「内核不知道任何具体生成器的参数名」：一旦内核里出现
    // u_push / u_dist 这类具体参数，它就不再是内核了。
    expect(sdfKernel('sdX')).not.toMatch(/u_push|u_dist|u_yaw|u_pitch|u_iter|u_scale/);
  });
});
