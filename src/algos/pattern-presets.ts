/**
 * pattern-presets.ts — 手绘种子图案的常用预设（纯数据）。
 *
 * 用 ASCII 网格字面量写，而不是 base64 —— 这些图案是**人类可读的常数**，
 * 写成人能一眼核对的形式，才能在 review 时发现「滑翔机枪少了一个点」
 * 这种错。编码成 base64 由 `pattern-codec.encodePattern` 在取用时做。
 *
 * 图案本身是公开的常识（Conway 生命游戏的标准构造），不涉及移植代码。
 */

import { bitmapFromRows, encodePattern, type Bitmap } from './pattern-codec';
import type { MessageKey } from '../i18n/locales';

export interface PatternPreset {
  id: string;
  labelKey: MessageKey;
  /** `.` = 空，`#` = 活。允许不等长（`bitmapFromRows` 按最长行补齐）。 */
  rows: readonly string[];
}

export const PATTERN_PRESETS: readonly PatternPreset[] = [
  {
    // 最小的飞行器：4 代后平移一格。
    id: 'glider',
    labelKey: 'algo.pattern.preset.glider',
    rows: ['.#.', '..#', '###'],
  },
  {
    // Gosper 滑翔机枪：每 30 代射出一只滑翔机。
    id: 'gospersGun',
    labelKey: 'algo.pattern.preset.gospersGun',
    rows: [
      '........................#...........',
      '......................#.#...........',
      '............##......##............##',
      '...........#...#....##............##',
      '##........#.....#...##..............',
      '##........#...#.##....#.#...........',
      '..........#.....#.......#...........',
      '...........#...#....................',
      '............##......................',
    ],
  },
  {
    // 周期 3 的振荡子。对称、稳定、一眼认得出。
    id: 'pulsar',
    labelKey: 'algo.pattern.preset.pulsar',
    rows: [
      '..###...###..',
      '.............',
      '#....#.#....#',
      '#....#.#....#',
      '#....#.#....#',
      '..###...###..',
      '.............',
      '..###...###..',
      '#....#.#....#',
      '#....#.#....#',
      '#....#.#....#',
      '.............',
      '..###...###..',
    ],
  },
  {
    // R-五连体：5 个细胞，混沌生长上千代，最终留下稳定的残骸。
    id: 'rPentomino',
    labelKey: 'algo.pattern.preset.rPentomino',
    rows: ['.##', '##.', '.#.'],
  },
  {
    // 橡实：7 个细胞，生长到约 6000 代。
    id: 'acorn',
    labelKey: 'algo.pattern.preset.acorn',
    rows: ['.#.....', '...#...', '##..###'],
  },
  {
    // Diehard：8 个细胞，130 代后**完全消失**。
    id: 'diehard',
    labelKey: 'algo.pattern.preset.diehard',
    rows: ['......#.', '##......', '.#...###'],
  },
];

const BY_ID = new Map<string, PatternPreset>(PATTERN_PRESETS.map((p) => [p.id, p]));

export function getPatternPreset(id: string): PatternPreset | null {
  return BY_ID.get(id) ?? null;
}

/** 预设 → 位图。未知 id 返回 `null`。 */
export function presetBitmap(id: string): Bitmap | null {
  const p = BY_ID.get(id);
  return p ? bitmapFromRows(p.rows) : null;
}

/** 预设 → 参数里存的那个串。未知 id 返回 `''`（= 无图案）。 */
export function presetParamValue(id: string): string {
  const bm = presetBitmap(id);
  return bm ? encodePattern(bm) : '';
}
