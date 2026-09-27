/**
 * blend.frag.ts — 合成 pass 的 GLSL 与 CPU 参考实现。
 *
 * GLSL 移植自 openmosh TEXT_BLEND_FRAG（MIT，见 CREDITS.md），去掉 invert，
 * u_blendMode 的编号与其保持一致。CPU 参考（blendRef）是同一套公式的 JS 版，
 * 单测拿已知值对打，E2E 再抽帧对照 GPU——两份实现互相钉死。
 */

import type { BlendMode } from '../core/schema';

export const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  add: 2,
  screen: 3,
  overlay: 4,
  difference: 5,
  exclusion: 6,
  subtract: 7,
};

export const BLEND_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;   // 已合成的下层（accumulator）
uniform sampler2D u_texture2;  // 本层（placement 后的 SourceClip）
uniform int u_blendMode;       // 0..7，编号见 BLEND_MODE_INDEX
uniform float u_opacity;       // 已含 fade 斜坡与 opacity 曲线
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 mainC = texture(u_texture, vUv);
  vec4 textC = texture(u_texture2, vUv);
  // 覆盖度是本层链自己产出的 alpha——placement 把层放进透明帧，
  // 层外 alpha 为 0，合成自然不动下层。
  float a = textC.a * u_opacity;
  vec3 mainRgb = mainC.rgb;
  vec3 textRgb = textC.rgb;
  vec3 blended;
  if (u_blendMode == 1) {
    blended = mainRgb * mix(vec3(1.0), textRgb, a);
  } else if (u_blendMode == 2) {
    blended = min(vec3(1.0), mainRgb + textRgb * a * 0.8);
  } else if (u_blendMode == 3) {
    blended = 1.0 - (1.0 - mainRgb) * (1.0 - textRgb * a);
  } else if (u_blendMode == 4) {
    vec3 t = mix(mainRgb, textRgb, a);
    blended = mix(2.0 * mainRgb * t, 1.0 - 2.0 * (1.0 - mainRgb) * (1.0 - t), step(0.5, mainRgb));
  } else if (u_blendMode == 5) {
    blended = mix(mainRgb, abs(mainRgb - textRgb), a);
  } else if (u_blendMode == 6) {
    vec3 t = mix(mainRgb, textRgb, a);
    blended = mainRgb + t - 2.0 * mainRgb * t;
  } else if (u_blendMode == 7) {
    blended = mix(mainRgb, max(vec3(0.0), mainRgb - textRgb), a);
  } else {
    blended = mix(mainRgb, textRgb, a);
  }
  // source-over 覆盖度，不是拍平 1.0：透明帧上叠透明层时 alpha 要累积。
  float outA = mainC.a + a * (1.0 - mainC.a);
  outColor = vec4(clamp(blended, 0.0, 1.0), clamp(outA, 0.0, 1.0));
}`;

/* --------------------------------------------------------- CPU 参考 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * blendRef(main, layer, mode, opacity) — 与 BLEND_FRAG 同公式的 CPU 版。
 * main / layer 都是 [r, g, b, a]（0..1），返回同样形状。
 */
export function blendRef(
  main: readonly number[],
  layer: readonly number[],
  mode: BlendMode,
  opacity: number,
): number[] {
  const a = layer[3]! * opacity;
  const m = [main[0]!, main[1]!, main[2]!];
  const t = [layer[0]!, layer[1]!, layer[2]!];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    switch (mode) {
      case 'multiply':
        out[i] = m[i]! * (1 + (t[i]! - 1) * a);
        break;
      case 'add':
        out[i] = Math.min(1, m[i]! + t[i]! * a * 0.8);
        break;
      case 'screen':
        out[i] = 1 - (1 - m[i]!) * (1 - t[i]! * a);
        break;
      case 'overlay': {
        const tt = m[i]! + (t[i]! - m[i]!) * a;
        out[i] = m[i]! < 0.5 ? 2 * m[i]! * tt : 1 - 2 * (1 - m[i]!) * (1 - tt);
        break;
      }
      case 'difference':
        out[i] = m[i]! + (Math.abs(m[i]! - t[i]!) - m[i]!) * a;
        break;
      case 'exclusion': {
        const tt = m[i]! + (t[i]! - m[i]!) * a;
        out[i] = m[i]! + tt - 2 * m[i]! * tt;
        break;
      }
      case 'subtract':
        out[i] = m[i]! + (Math.max(0, m[i]! - t[i]!) - m[i]!) * a;
        break;
      default:
        out[i] = m[i]! + (t[i]! - m[i]!) * a;
    }
  }
  const outA = main[3]! + a * (1 - main[3]!);
  return [clamp01(out[0]!), clamp01(out[1]!), clamp01(out[2]!), clamp01(outA)];
}
