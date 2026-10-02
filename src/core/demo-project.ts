/**
 * demo-project.ts — 内置工程工厂（开箱 demo + 空白）。
 *
 * 开箱 demo 工程：16 秒 @120BPM（8 小节）。M1 验收里的三层结构：
 *   V1 底图      Mandelbrot 缓慢推近（zoom 关键帧，验证 realtime 参数曲线）
 *   V2 纹理      Rule 110 生长（screen 混合叠在底图上）
 *   V3 局部故障  只在第 5–8 小节出现的 slices + channel-split（adjustment layer）
 *   V4 全屏调色  echo 拖尾 + 扫描线，全程（作用于 z 序之下所有层）
 * 音频是程序生成的演示节拍（audio/demo-audio.ts，无外部文件依赖）。
 */

import { defaultProject, newId, type Project, type SourceClip, type EffectClip } from './schema';

export const DEMO_ASSET_ID = 'demo-song';
export const DEMO_DURATION = 16;

/**
 * 空白工程：一视觉 + 一音频两条轨。
 *
 * **不留空轨道列表。** 没有轨道的话右键菜单出不来、片段也没地方放，
 * 用户面对的是一块完全动不了的地方 —— 那不是「空白」，那是「坏了」。
 */
export function createBlankProject(name = '未命名工程'): Project {
  const p = defaultProject(name);
  p.tracks = [
    { kind: 'visual', id: newId(), name: 'V1', enabled: true, clips: [] },
    { kind: 'audio', id: newId(), name: 'A1', enabled: true, bus: 'master', clips: [] },
  ];
  return p;
}

function baseClip(id: string, start: number, end: number, label: string) {
  return { id, start, end, label, fadeSec: 0, curves: {} };
}

const transform = { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 };

export function createDemoProject(): Project {
  const p = defaultProject('Artmatic Demo');
  p.duration = DEMO_DURATION;
  p.beatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };
  p.assets[DEMO_ASSET_ID] = {
    id: DEMO_ASSET_ID,
    kind: 'audio',
    name: '演示节拍 120 BPM',
    durationSec: DEMO_DURATION,
  };

  const mandelbrot: SourceClip = {
    ...baseClip(newId(), 0, DEMO_DURATION, 'Mandelbrot 推近'),
    kind: 'source',
    source: {
      type: 'algo',
      generator: 'mandelbrot',
      params: {
        cx: -0.745, cy: 0.113, zoom: 0, maxIter: 256,
        colorA: '#0b1e3a', colorB: '#ffd27f', colorIn: '#000000', intRes: '480',
      },
    },
    blend: 'normal',
    opacity: 1,
    transform: { ...transform },
    fit: 'stretch',
    curves: {
      // 缓慢推近：0 → 2.6 全程（clip 相对，未锚拍）
      zoom: {
        keys: [
          { t: 0, v: 0, interp: 'linear' },
          { t: DEMO_DURATION, v: 2.6, interp: 'linear' },
        ],
      },
    },
  };

  const rule110: SourceClip = {
    ...baseClip(newId(), 0, DEMO_DURATION, 'Rule 110 生长'),
    kind: 'source',
    source: {
      type: 'algo',
      generator: 'rule110',
      params: {
        rule: '110', width: 1024, height: 512, seedMode: 'single',
        speed: 128, colorBg: '#05070f', colorLive: '#7fd4ff',
      },
    },
    blend: 'screen',
    opacity: 0.65,
    transform: { ...transform },
    fit: 'stretch',
    curves: {},
  };

  const glitch: EffectClip = {
    ...baseClip(newId(), 8, 12, '局部故障'),
    kind: 'effect',
    fadeSec: 0.25,
    chain: [
      {
        instanceId: newId(),
        defId: 'slices',
        enabled: true,
        values: { count: 48, amount: 0.14, coverage: 0.5 },
      },
      {
        instanceId: newId(),
        defId: 'channel-split',
        enabled: true,
        values: { amount: 7, angle: 0 },
      },
    ],
    curves: {},
  };

  const grade: EffectClip = {
    ...baseClip(newId(), 0, DEMO_DURATION, '回声 + 扫描线'),
    kind: 'effect',
    chain: [
      {
        instanceId: newId(),
        defId: 'echo',
        enabled: true,
        values: { decay: 0.86, floor: 0.03, weight: 0.72, zoom: 0.006, spin: 0 },
      },
      {
        instanceId: newId(),
        defId: 'scanlines',
        enabled: true,
        values: { intensity: 0.16, spacing: 3 },
      },
    ],
    curves: {},
  };

  /**
   * 轨道顺序 = **从前景到背景**（列表自上而下）。
   *
   * `buildStack` 把列表顶部映射成最大 z，所以这里必须「全屏调色在最上、
   * 底图在最下」——这正是 Premiere 的惯例（V4 压 V3 压 V2 压 V1）。
   * 音频轨与视觉栈无关，放最后由它去。
   */
  p.tracks = [
    { kind: 'visual', id: newId(), name: 'V4 全屏调色', enabled: true, clips: [grade] },
    { kind: 'visual', id: newId(), name: 'V3 局部故障', enabled: true, clips: [glitch] },
    { kind: 'visual', id: newId(), name: 'V2 纹理', enabled: true, clips: [rule110] },
    { kind: 'visual', id: newId(), name: 'V1 底图', enabled: true, clips: [mandelbrot] },
    {
      kind: 'audio',
      id: newId(),
      name: 'A1 音乐',
      enabled: true,
      bus: 'master',
      clips: [
        {
          ...baseClip(newId(), 0, DEMO_DURATION, '演示节拍'),
          kind: 'audio',
          assetId: DEMO_ASSET_ID,
          srcIn: 0,
        },
      ],
    },
  ];
  return p;
}
