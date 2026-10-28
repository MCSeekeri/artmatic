/**
 * qr-code.ts — 二维码（机器可读符号），`sim` 型（**无步进状态**的静态图案）。
 *
 * 把输入文本编成七种符号之一的模块图：QR Code / 一维条形码（Code 128）/
 * Aztec / Data Matrix / MaxiCode / Grid Matrix / 汉信码。编码与保真度见
 * `symbology/index.ts`（QR 与 Code 128 是完整标准、其余是结构复刻）。
 *
 * ## 为什么借 `sim` 这条通路（而不是 bake / realtime）
 *
 * 三个硬需求把三种型筛成了这一种：
 *
 * - **内容是 CPU 算出来的**：文本 → 字节 → RS 纠错 → 模块布局，GLSL 做不了
 *   （而且也不能做 —— 编码器要能被单测直接打）。
 * - **不能有揭示动画**：`bake` 的 reveal 前沿由 `t` 驱动，`t = playhead` 在片段
 *   头上时前沿为 0 ⇒ 整幅不显示。二维码在第 0 帧就应该是完整的一张码。
 * - **每帧都要有内容**：`realtime` 只有逐帧 shader，没有「按参数烘一张纹理、
 *   之后一直用」的挂载点（`auxTextures` 只按 kind 全局缓存，不看参数）。
 *
 * `sim` 恰好就是「按 clip 缓存一张 R8 纹理 + contain 适配 + 双色调 + `bgMode`」：
 * `create()` 里编码一次、`seek()` 是 no-op、`current()` 交出同一份字节。
 * 「`seek(f) ≡ 从 0 顺序 step f 次`」于是**平凡成立**（状态恒定，没有步进）。
 * 内容/符号改了 → `cacheHash` 变了 → 运行时重建这个句柄，正是要的语义。
 *
 * ## 两处自己踩出来的口径
 *
 * 1. **纹理是「一个模块一个像素」**，`NEAREST` 采样。所以着色器里不能直接采样
 *    就算完 —— 那样每个模块是硬边方框，圆角参数无从谈起。这里按模块坐标
 *    （`u_modW` / `u_modH`）在着色器里重画一遍形状：`round = 0` 是硬边方阵、
 *    `0.5` 是圆点，中间值是圆角方块，边缘按模块空间里的像素尺寸做抗锯齿。
 * 2. **`u_modW`/`u_modH` 不能从参数算**：符号尺寸是内容与纠错级别的函数（而且
 *    是编码器决定的）。所以 `setTintUniforms` 与 `create()` 都调同一个
 *    `matrixOf()`，靠一张小缓存兜住 —— 两处各自乱编的话，会在「改内容」时出现
 *    两份不一致的结果（一份进纹理、一份进 uniform），症状是圆角与模块边界错位。
 */

import { bgColorVisible, bgModeParam } from './shader-lib';
import { encodeCode, type CodeMatrix, type QrEcLevel } from './symbology';
import type { GeneratorDef } from './types';

/**
 * 着色器：取模块值 → 按模块坐标重画（圆角 / 圆点）→ 与底色或透明底合成。
 *
 * `TINT_HEAD` 已经声明了 `u_tex` / `u_colorBg` / `u_colorLive` / `u_bgMode` /
 * contain 适配（`containUv` / `insideUv`），这里**只写 main 与私有 uniform**。
 */
const TINT = `
uniform float u_round;  // 模块圆角（0 = 方，0.5 = 圆）
uniform float u_modW;   // 模块列数（含静区）
uniform float u_modH;   // 模块行数（含静区）

float moduleAt(vec2 c) {
  return texture(u_tex, (c + 0.5) / max(vec2(u_modW, u_modH), vec2(1.0))).r;
}

void main() {
  vec2 uv = containUv(vUv);
  vec2 grid = max(vec2(u_modW, u_modH), vec2(1.0));
  vec2 q = uv * grid;
  vec2 base = floor(q);
  vec2 f = q - base - 0.5;

  float mSelf = moduleAt(base);
  float mLeft = moduleAt(base + vec2(-1.0, 0.0));
  float mRight = moduleAt(base + vec2(1.0, 0.0));
  float mDown = moduleAt(base + vec2(0.0, -1.0));
  float mUp = moduleAt(base + vec2(0.0, 1.0));

  // 模块空间里的像素尺寸。**用它当 AA 带宽**，而不是 fwidth(某个距离场)：
  // 距离场在分支里取值，导数在那里不可靠（GLSL 的非一致控制流）。
  float aa = max(max(fwidth(q.x), fwidth(q.y)), 1e-5);
  float r = clamp(u_round, 0.0, 0.49);

  float shape = 0.0;
  if (mSelf > 0.5) {
    if (r < 0.02) {
      /*
       * 并集（默认）：只有「邻格是白」的那几条边才是轮廓。
       *
       * 逐格算圆角 SDF 的话，两个相邻暗模块的公共边上距离恰好为 0，AA 会把它
       * 画成一条 50% 的缝 —— 实测表现是整张码上浮出一层细网格线，定位图形
       * 的实心区域里也全是线。按邻居判轮廓之后公共边不再进 AA，缝就没了。
       */
      float need = 1e6;
      if (mLeft < 0.5) need = min(need, 0.5 + f.x);
      if (mRight < 0.5) need = min(need, 0.5 - f.x);
      if (mDown < 0.5) need = min(need, 0.5 + f.y);
      if (mUp < 0.5) need = min(need, 0.5 - f.y);
      shape = need > 1e5 ? 1.0 : smoothstep(-aa, aa, need);
    } else {
      /*
       * 圆角 / 圆点：逐模块收缩成圆角方块。这里的「缝」是**目的** ——
       * 模块本来就是一颗颗独立的点。第二项 min(max(d.x,d.y),0.0) 是格内的
       * 负距离，不能省：少了它格内距离恒为 0，每个暗格都会被画成 50% 灰的
       * 空心方框（实测踩过）。
       */
      vec2 d = abs(f) - (0.5 - r);
      float dist = length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
      shape = 1.0 - smoothstep(-aa, aa, dist);
    }
  }

  float ink = shape * insideUv(uv);
  // 透明底必须吐「墨色 + 覆盖度」（直通 alpha）—— 见 shader-lib.ts 的 TINT_FRAG
  if (u_bgMode == 1) outColor = vec4(u_colorLive, ink);
  else outColor = vec4(mix(u_colorBg, u_colorLive, ink), 1.0);
}`;

/**
 * 编码结果的小缓存。
 *
 * 存在的理由见文件头第 2 条：`create()` 与 `setTintUniforms()` 必须看到**同一份**
 * 结果（尺寸错了，圆角与模块栅格就错位）。
 *
 * 为什么不是「1 项 memo」：`setTintUniforms` **每帧**都要读尺寸，而时间轴上同时
 * 有两条二维码片段时，逐帧交替查询会让单项缓存每次都落空 —— 变成每帧重编两次。
 * 4 项足够覆盖「同屏几条」，超了按插入顺序丢最老的（编码结果是纯数据、无句柄，
 * 丢了只是重算一次）。
 */
const MEMO_MAX = 4;
const memo = new Map<string, CodeMatrix>();

const EC_LEVELS: readonly QrEcLevel[] = ['L', 'M', 'Q', 'H'];

function matrixOf(v: Record<string, number | string>): CodeMatrix {
  const rawEc = String(v.ec ?? 'M');
  const ec = (EC_LEVELS.includes(rawEc as QrEcLevel) ? rawEc : 'M') as QrEcLevel;
  const id = String(v.symbology ?? 'qr');
  const content = String(v.content ?? '');
  const quiet = Number(v.quiet ?? 4);
  const barHeight = Number(v.barHeight ?? 14);
  const key = [id, content, ec, quiet, barHeight].join('\u0001');

  const hit = memo.get(key);
  if (hit) return hit;

  const made = encodeCode(id, content, { ec, quiet, barHeight });
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, made);
  return made;
}

export const qrCodeDef: GeneratorDef = {
  id: 'qr-code',
  nameKey: 'algo.qrCode',
  kind: 'sim',
  /*
   * 只有渲染期读的东西：圆角与配色不进构造哈希 —— 拖圆角不该把编码器再跑一遍
   * （不是性能问题，是「改一个纯显示参数会重建纹理」这件事本身没有语义）。
   * `quiet` / `barHeight` / `content` / `symbology` / `ec` 都改纹理，**不能**列进来。
   */
  volatile: ['round', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    {
      key: 'content',
      labelKey: 'algo.qr.content',
      type: 'text',
      defaultValue: 'ARTMATIC',
      maxLength: 256,
      placeholderKey: 'algo.qr.contentPlaceholder',
    },
    {
      key: 'symbology',
      labelKey: 'algo.qr.symbology',
      type: 'select',
      defaultValue: 'qr',
      options: [
        { labelKey: 'algo.qr.symQr', value: 'qr' },
        { labelKey: 'algo.qr.symCode128', value: 'code128' },
        { labelKey: 'algo.qr.symAztec', value: 'aztec' },
        { labelKey: 'algo.qr.symDataMatrix', value: 'datamatrix' },
        { labelKey: 'algo.qr.symMaxiCode', value: 'maxicode' },
        { labelKey: 'algo.qr.symGridMatrix', value: 'gridmatrix' },
        { labelKey: 'algo.qr.symHanXin', value: 'hanxin' },
      ],
    },
    {
      key: 'ec',
      labelKey: 'algo.qr.ec',
      type: 'select',
      defaultValue: 'M',
      visibleWhen: (v) => v.symbology === 'qr',
      options: [
        { labelKey: 'algo.qr.ecL', value: 'L' },
        { labelKey: 'algo.qr.ecM', value: 'M' },
        { labelKey: 'algo.qr.ecQ', value: 'Q' },
        { labelKey: 'algo.qr.ecH', value: 'H' },
      ],
    },
    {
      /*
       * 静区（模块）。出厂 4 是二维码的标准值；一维码标准要 ≥10，但那个数字是
       * **渲染留白**而不是编码的一部分（图案本身是完整的），所以不给两套缺省 ——
       * 要更宽就自己拉。
       */
      key: 'quiet',
      labelKey: 'algo.qr.quiet',
      type: 'range',
      min: 0,
      max: 24,
      step: 1,
      defaultValue: 4,
    },
    {
      key: 'barHeight',
      labelKey: 'algo.qr.barHeight',
      type: 'range',
      min: 4,
      max: 48,
      step: 1,
      defaultValue: 14,
      visibleWhen: (v) => v.symbology === 'code128',
    },
    {
      key: 'round',
      labelKey: 'algo.qr.round',
      type: 'range',
      min: 0,
      max: 0.5,
      step: 0.01,
      defaultValue: 0,
    },
    {
      key: 'colorBg',
      labelKey: 'algo.qr.colorBg',
      type: 'color',
      defaultValue: '#0b0c10',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.qr.colorLive', type: 'color', defaultValue: '#f2f5fa' },
    bgModeParam(),
  ],
  tintFragment: TINT,
  create(params) {
    const m = matrixOf(params);
    return {
      gridW: m.w,
      gridH: m.h,
      stepsPerSec: 1,
      /** 没有步进状态：图案与「模拟走到第几步」无关（见文件头）。 */
      seek() {},
      current: () => m.data,
    };
  },
  setTintUniforms: (gl, l, v) => {
    const m = matrixOf(v);
    const roundLoc = l['u_round'];
    if (roundLoc) gl.uniform1f(roundLoc, Number(v.round) || 0);
    const wLoc = l['u_modW'];
    if (wLoc) gl.uniform1f(wLoc, m.w);
    const hLoc = l['u_modH'];
    if (hLoc) gl.uniform1f(hLoc, m.h);
  },
};
