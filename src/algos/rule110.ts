/**
 * rule110.ts — 基本元胞自动机（Rule 30/90/110），bake 型。
 *
 * 移植自 angel-echo js/automata.js 的 elementary()（同作者内部移植）。
 *
 * 血泪常量：活细胞必须写 LIVE = 255，不是 1。R8 纹理把字节归一化到
 * 0..1，写 1 得到 0.0039，着色器里任何阈值（smoothstep(0.4, 0.9, v)）
 * 都把它抹成 0——整幅图只剩抖动噪声。LIVE 是唯一定义，禁止裸写。
 */

import { mulberry32 } from '../core/prng';
import type { GeneratorDef } from './types';

export const LIVE = 255;

export function elementary(
  rule: number,
  w: number,
  h: number,
  seedMode: 'single' | 'random',
  seed: number,
): { data: Uint8Array; w: number; h: number } {
  const out = new Uint8Array(w * h);
  let row = new Uint8Array(w);
  if (seedMode === 'single') {
    row[w >> 1] = 1;
  } else {
    const rnd = mulberry32(seed);
    for (let i = 0; i < w; i++) row[i] = rnd() < 0.5 ? 1 : 0;
  }
  const bits = rule & 0xff;
  for (let y = 0; y < h; y++) {
    const dst = y * w;
    for (let x = 0; x < w; x++) if (row[x]) out[dst + x] = LIVE;
    const next = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const l = row[(x - 1 + w) % w]!;
      const c = row[x]!;
      const r = row[(x + 1) % w]!;
      next[x] = (bits >> ((l << 2) | (c << 1) | r)) & 1;
    }
    row = next;
  }
  return { data: out, w, h };
}

export const rule110Def: GeneratorDef = {
  id: 'rule110',
  name: '基本元胞自动机',
  kind: 'bake',
  params: [
    {
      key: 'rule',
      label: '规则',
      type: 'select',
      defaultValue: '110',
      options: [
        { label: 'Rule 30（混沌）', value: '30' },
        { label: 'Rule 90（分形）', value: '90' },
        { label: 'Rule 110（图灵完备）', value: '110' },
      ],
    },
    { key: 'width', label: '宽度', type: 'range', min: 128, max: 2048, step: 64, defaultValue: 1024 },
    { key: 'height', label: '高度', type: 'range', min: 128, max: 2048, step: 64, defaultValue: 512 },
    {
      key: 'seedMode',
      label: '种子',
      type: 'select',
      defaultValue: 'single',
      options: [
        { label: '单点', value: 'single' },
        { label: '随机 50%', value: 'random' },
      ],
    },
    { key: 'speed', label: '生长速度(行/秒)', type: 'range', min: 0, max: 400, step: 1, defaultValue: 96 },
    { key: 'colorBg', label: '背景色', type: 'color', defaultValue: '#05070f' },
    { key: 'colorLive', label: '活细胞色', type: 'color', defaultValue: '#7fd4ff' },
  ],
  bake(params, seed) {
    const w = Math.round(Number(params.width) || 1024);
    const h = Math.round(Number(params.height) || 512);
    const rule = Number(params.rule) || 110;
    const seedMode = params.seedMode === 'random' ? 'random' : 'single';
    const { data } = elementary(rule, w, h, seedMode, seed);
    return { data, w, h, frontMax: h };
  },
};
