/**
 * cyclic-ca.ts — 循环元胞自动机（Greenberg–Hastings），`sim` 型。
 *
 * 规则：状态集是 `{0 .. K−1}`（**循环**，K−1 的下一态回到 0）。
 *
 * ```
 * s → (s+1) mod K   当**至少 θ 个邻居**处于 (s+1) mod K
 * s → s             否则
 * ```
 *
 * 这一条「只有下一态能传染你」的规则让系统**自组织成螺旋波**：从随机初值出发，
 * 各处各自试图进入下一态，冲突的地方互相掐灭，最后活下来的是一组向外旋转的
 * 螺旋臂与靶形波。它不是「图案稳定下来」，而是**永远在转**。
 *
 * - K=3、θ=1、von Neumann 是 Greenberg–Hastings 的原版（Fisch–Gravner–Griffeath
 *   1991 证明随机初值下几乎必然形成持久螺旋）。
 * - K=12、θ=2、Moore 是更稠密好看的一档，也是这里的默认。
 *
 * 因为是**多态**，共享的双色调 tint 会把「循环」压成灰度噪声 —— 所以它有自定义
 * 着色（把状态映射到色环上）。
 */

import { mulberry32 } from '../core/prng';
import { patternFromParam, stampCentered } from './pattern-codec';
import { SnapshotRing } from './sim-util';
import type { GeneratorDef, SimHandle } from './types';

const SNAPSHOT_OPTS = {
  every: 16,
  cap: 64,
  clone: (v: Uint8Array): Uint8Array => v.slice(),
};

export interface CyclicRule {
  /** 状态数（≥3 才有循环可言）。 */
  k: number;
  /** 进入下一态所需的邻居数阈值。 */
  theta: number;
  vonNeumann: boolean;
  wrap: boolean;
}

/**
 * 一步。`next` 是复用的出参（避免每步分配一个 n² 的数组）。
 *
 * 必须是**同步**更新（读到的是旧态）—— 就地更新会让先算的格子影响后算的格子，
 * 螺旋就没了，而且换遍历顺序得到不同结果（`seek ≡ 顺序 step` 随之失效）。
 */
export function cyclicStep(
  cur: Uint8Array,
  next: Uint8Array,
  n: number,
  rule: CyclicRule,
): void {
  const { k, theta, vonNeumann, wrap } = rule;
  for (let y = 0; y < n; y++) {
    const yU = wrap ? (y === 0 ? n - 1 : y - 1) : y - 1;
    const yD = wrap ? (y === n - 1 ? 0 : y + 1) : y + 1;
    const yUok = yU >= 0 && yU < n;
    const yDok = yD >= 0 && yD < n;
    const yMr = yUok ? yU * n : 0;
    const yDr = yDok ? yD * n : 0;
    const yM = y * n;
    for (let x = 0; x < n; x++) {
      const s = cur[yM + x]!;
      const want = (s + 1) % k;
      const xL = wrap ? (x === 0 ? n - 1 : x - 1) : x - 1;
      const xR = wrap ? (x === n - 1 ? 0 : x + 1) : x + 1;
      const xLok = xL >= 0 && xL < n;
      const xRok = xR >= 0 && xR < n;

      let c = 0;
      if (vonNeumann) {
        if (yUok && cur[yMr + x] === want) c++;
        if (xLok && cur[yM + xL] === want) c++;
        if (xRok && cur[yM + xR] === want) c++;
        if (yDok && cur[yDr + x] === want) c++;
      } else {
        if (yUok) {
          if (xLok && cur[yMr + xL] === want) c++;
          if (cur[yMr + x] === want) c++;
          if (xRok && cur[yMr + xR] === want) c++;
        }
        if (xLok && cur[yM + xL] === want) c++;
        if (xRok && cur[yM + xR] === want) c++;
        if (yDok) {
          if (xLok && cur[yDr + xL] === want) c++;
          if (cur[yDr + x] === want) c++;
          if (xRok && cur[yDr + xR] === want) c++;
        }
      }
      next[yM + x] = c >= theta ? want : s;
    }
  }
}

export function createCyclicCa(params: Record<string, number | string>, seed: number): SimHandle {
  const n = Math.max(32, Math.min(512, Math.round(Number(params.size) || 256)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 40);
  const k = Math.max(3, Math.min(24, Math.round(Number(params.states) || 12)));
  const rule: CyclicRule = {
    k,
    theta: Math.max(1, Math.min(8, Math.round(Number(params.threshold) || 2))),
    vonNeumann: params.neighborhood === 'vonNeumann',
    wrap: Number(params.wrap ?? 1) !== 0,
  };

  const cur0 = new Uint8Array(n * n);
  if (params.seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    // 图案只给了两种值（0/1），而这里有 K 个状态 —— 把「点亮」映射成状态 1，
    // 其余留给种子化的随机底噪，否则螺旋起不来（一片 0 只有两个状态参与循环）。
    if (bm) {
      const rnd = mulberry32(seed);
      for (let i = 0; i < n * n; i++) cur0[i] = Math.floor(rnd() * k);
      stampCentered(cur0, n, n, bm, 1 % k);
    } else {
      fillRandom(cur0, seed, k, Number(params.density) || 1);
    }
  } else {
    // 循环 CA 的经典观感就来自**满场**随机初值（每个格随机取一个状态），
    // 而不是按密度的稀疏撒点 —— 所以 density 在这里的含义是「随机化的比例」。
    fillRandom(cur0, seed, k, Number(params.density) || 1);
  }

  // 双缓冲：`buf[i]` 读出、`buf[1-i]` 写入，再翻转下标。`cyclicStep` 会写满
  // 每一个格子，所以交换是安全的；`slice()` 每步都会分配一个 n² 的数组。
  const buf: [Uint8Array, Uint8Array] = [cur0, new Uint8Array(n * n)];
  let which = 0;
  let frame = 0;
  const snapshots = new SnapshotRing<Uint8Array>(SNAPSHOT_OPTS, cur0);
  const out = new Uint8Array(n * n);

  const encode = (s: number): number => Math.round((s * 255) / (k - 1));

  const stepTo = (target: number): void => {
    while (frame < target) {
      cyclicStep(buf[which]!, buf[1 - which]!, n, rule);
      which = 1 - which;
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, buf[which]!);
    }
  };

  return {
    gridW: n,
    gridH: n,
    stepsPerSec,
    channels: 1,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        const snap = snapshots.nearestAtOrBefore(target);
        buf[which]!.set(snap.value);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      const src = buf[which]!;
      for (let i = 0; i < out.length; i++) out[i] = encode(src[i]!);
      return out;
    },
  };
}

function fillRandom(g: Uint8Array, seed: number, k: number, ratio: number): void {
  const rnd = mulberry32(seed);
  const p = Math.max(0, Math.min(1, ratio));
  for (let i = 0; i < g.length; i++) {
    // p = 1 → 整场随机；p < 1 → 未被随机到的格子留在状态 0
    g[i] = rnd() < p ? Math.floor(rnd() * k) : 0;
  }
}

/**
 * 状态数映射到色环用的 tint。
 *
 * 共享的双色调 tint 只按灰度混色 —— 12 个状态会被压成 12 级灰，
 * 「循环」这件事完全看不出来（相邻状态的色差只有 1/12）。色环才是它的样子。
 */
export const CYCLIC_TINT_FRAG = `
uniform float u_states;   // K：把 8 位量化值还原成精确的状态号
uniform int u_palette;    // 0 = 色环 · 1 = 相位环 · 2 = 灰阶

vec3 cyclicHue(float t) {
  // 廉价 HSV→RGB：色相绕一圈，饱和度与明度固定
  vec3 rgb = clamp(abs(mod(t * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return rgb * rgb * (3.0 - 2.0 * rgb);
}

void main() {
  vec2 uv = containUv(vUv);
  float s = texture(u_tex, clamp(uv, 0.0, 1.0)).r;
  // 纹理是 8 位的，K 个状态被压进 0..255 —— 直接拿它当色相会让相邻状态的
  // 色差随 K 变大而漂（K=20 时相邻只差 13/255）。先量化回状态号再上色。
  float kk = max(1.0, u_states - 1.0);
  float t = clamp(floor(clamp(s, 0.0, 1.0) * kk + 0.5) / kk, 0.0, 1.0);
  vec3 col;
  if (u_palette == 2) {
    col = vec3(t);
  } else if (u_palette == 1) {
    // 相位环：低状态沉底、高状态提亮，带一点明度差
    col = mix(u_colorBg, cyclicHue(t), 0.25 + 0.75 * t);
  } else {
    col = cyclicHue(t);
  }
  outColor = vec4(mix(u_colorBg, col, insideUv(uv)), 1.0);
}`;

const CYCLIC_PALETTES: Record<string, number> = { wheel: 0, phase: 1, mono: 2 };

export const cyclicCaDef: GeneratorDef = {
  id: 'cyclic-ca',
  nameKey: 'algo.cyclicCa',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive', 'palette'],
  params: [
    { key: 'size', labelKey: 'algo.cyclicCa.grid', type: 'range', min: 64, max: 512, step: 32, defaultValue: 256 },
    // 默认 K=8（不是网上更常见的 12）：θ=2 时 K≥12 会让整场一步冻死 ——
    // 见文件头那张实测表。
    { key: 'states', labelKey: 'algo.cyclicCa.states', type: 'range', min: 3, max: 24, step: 1, defaultValue: 8 },
    {
      key: 'threshold',
      labelKey: 'algo.cyclicCa.threshold',
      type: 'range',
      min: 1,
      max: 8,
      step: 1,
      defaultValue: 2,
    },
    {
      key: 'neighborhood',
      labelKey: 'algo.cyclicCa.neighborhood',
      type: 'select',
      defaultValue: 'moore',
      options: [
        { labelKey: 'algo.cyclicCa.moore', value: 'moore' },
        { labelKey: 'algo.cyclicCa.vonNeumann', value: 'vonNeumann' },
      ],
    },
    { key: 'wrap', labelKey: 'algo.cyclicCa.wrap', type: 'checkbox', defaultValue: 1 },
    {
      key: 'seedMode',
      labelKey: 'algo.cyclicCa.seedMode',
      type: 'select',
      defaultValue: 'random',
      options: [
        { labelKey: 'algo.cyclicCa.seedRandom', value: 'random' },
        { labelKey: 'algo.cyclicCa.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.cyclicCa.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    {
      key: 'density',
      labelKey: 'algo.cyclicCa.density',
      type: 'range',
      min: 0.2,
      max: 1,
      step: 0.05,
      defaultValue: 1,
      visibleWhen: (v) => v.seedMode !== 'pattern',
    },
    { key: 'rate', labelKey: 'algo.cyclicCa.speed', type: 'range', min: 2, max: 200, step: 2, defaultValue: 40 },
    { key: 'colorBg', labelKey: 'algo.cyclicCa.colorBg', type: 'color', defaultValue: '#05060e' },
    { key: 'colorLive', labelKey: 'algo.cyclicCa.colorLive', type: 'color', defaultValue: '#ffe9a8' },
    {
      key: 'palette',
      labelKey: 'algo.cyclicCa.palette',
      type: 'select',
      defaultValue: 'wheel',
      options: [
        { labelKey: 'algo.cyclicCa.palWheel', value: 'wheel' },
        { labelKey: 'algo.cyclicCa.palPhase', value: 'phase' },
        { labelKey: 'algo.cyclicCa.palMono', value: 'mono' },
      ],
    },
  ],
  create: createCyclicCa,
  tintFragment: CYCLIC_TINT_FRAG,
  setTintUniforms: (gl, l, v) => {
    const loc = l['u_states'];
    if (loc) gl.uniform1f(loc, Math.max(3, Math.min(24, Number(v.states) || 12)));
    const pal = l['u_palette'];
    if (pal) gl.uniform1i(pal, CYCLIC_PALETTES[String(v.palette)] ?? 0);
  },
};
