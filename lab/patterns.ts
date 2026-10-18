/**
 * patterns.ts — 试炼场内置的**程序化测试图**。
 *
 * 为什么需要它：openmosh 的 lab 是把真实视频拖进来审 shader，而 artmatic
 * 的 `video` 源是空壳（engine/sources.ts 里 `default: return null`）、图片源
 * 也还没接。审特效只剩算法生成器可用，但生成器是"有内容"的画面，不擅长
 * 暴露某一类问题。测试图的作用是**把问题放大**：
 *
 *   lab:bars      彩色竖条 —— 通道位移（channel-split）在色块边界上一眼可见
 *   lab:grid      细网格   —— 量化/周期性（pixelate / scanlines）会打出摩尔纹
 *   lab:gradient  平滑渐变 —— 色带（banding）与拖尾（echo）最容易读
 *
 * 这几张图**不注册进 `algos/registry.ts`**。它们是试炼场的工具，不是产品
 * 功能；混进生成器列表会让用户在时间轴上选到一个只在调试时有意义的条目。
 * 接入方式是给它们 `lab:` 前缀的伪 generator id，由试炼场自己包一层
 * resolver 拦截 —— 不动 schema、不动注册表。
 *
 * 2026-10：彩条 / 网格 / 渐变的**产品版**已经独立落地（`algos/bars.ts` /
 * `grid.ts` / `gradient.ts`，带可调参数、与内部分辨率解耦）。这里的测试图
 * 仍然是那三条的 lab 专用变体 —— 两者**不是同一份实现**，改产品版不要顺手
 * 改这里（它们的用途分别是「审特效」与「给用户用」）。
 */

import type { Kit, Target } from '../src/engine/kit';
import type { SourceTexture } from '../src/engine/compositor';
import type { MessageKey } from '../src/i18n/locales';

const HEAD = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 vUv;
out vec4 outColor;
`;

/** 彩条：7 条等宽竖条 + 底部一条灰阶。色块边界是通道位移的放大镜。 */
const BARS = `${HEAD}
vec3 barColor(float i) {
  if (i < 0.5) return vec3(1.0, 1.0, 1.0);
  if (i < 1.5) return vec3(1.0, 1.0, 0.0);
  if (i < 2.5) return vec3(0.0, 1.0, 1.0);
  if (i < 3.5) return vec3(0.0, 1.0, 0.0);
  if (i < 4.5) return vec3(1.0, 0.0, 1.0);
  if (i < 5.5) return vec3(1.0, 0.0, 0.0);
  return vec3(0.0, 0.0, 1.0);
}
void main() {
  // 底部 20% 是 0→1 灰阶斜坡，用于读 banding。
  if (vUv.y < 0.2) {
    float g = floor(vUv.x * 16.0) / 15.0;
    outColor = vec4(vec3(g), 1.0);
    return;
  }
  float i = floor(vUv.x * 7.0);
  outColor = vec4(barColor(i), 1.0);
}`;

/** 网格：1px 线在细密网格上，pixelate / scanlines 会立刻打出摩尔纹。 */
const GRID = `${HEAD}
void main() {
  vec2 p = vUv * u_resolution;
  vec2 g = abs(fract(p / 32.0) - 0.5);
  // 线宽固定 1 设备像素：随分辨率变化，正好暴露采样问题。
  float line = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y) * 32.0);
  vec3 bg = vec3(0.08);
  outColor = vec4(mix(bg, vec3(1.0), line), 1.0);
}`;

/** 渐变：缓慢旋转的锥形渐变。确定性（只吃 u_time），供「异 t 异帧」断言。 */
const GRADIENT = `${HEAD}
void main() {
  vec2 c = vUv - 0.5;
  float a = atan(c.y, c.x) + u_time * 0.15;
  float r = length(c) * 1.6;
  vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + a + r * 3.0);
  outColor = vec4(col, 1.0);
}`;

export interface LabPattern {
  id: string;
  nameKey: MessageKey;
  fragment: string;
}

export const PATTERNS: LabPattern[] = [
  { id: 'lab:bars', nameKey: 'lab.patBars', fragment: BARS },
  { id: 'lab:grid', nameKey: 'lab.patGrid', fragment: GRID },
  { id: 'lab:gradient', nameKey: 'lab.patGradient', fragment: GRADIENT },
];

export function isPatternId(id: string): boolean {
  return id.startsWith('lab:');
}

/**
 * 把测试图渲成一张纹理。
 *
 * 按渲染尺寸池化 Target：尺寸一变就重建（`Target.resize` 会重新分配纹理，
 * 旧内容随之失效——这正是我们要的语义，测试图无历史）。
 * program 走 `kit.quad` 的**按名缓存**，反复切图不会重复编译。
 */
export class PatternRenderer {
  private readonly pool = new Map<string, Target>();

  constructor(private readonly kit: Kit) {}

  render(id: string, t: number): SourceTexture | null {
    const pat = PATTERNS.find((p) => p.id === id);
    if (!pat) return null;
    const w = this.kit.w;
    const h = this.kit.h;
    const key = `${w}x${h}`;
    let out = this.pool.get(key);
    if (!out) {
      out = this.kit.target(w, h);
      this.pool.set(key, out);
    }
    const prog = this.kit.quad(pat.fragment, `lab-pattern-${id}`);
    prog.use().u('u_time', t).u('u_resolution', [w, h]);
    this.kit.pass(prog, out);
    return { tex: out.tex, w, h };
  }
}
