import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { fontHasWeightAxis } from '../../src/typography/font/sfnt';

/**
 * 造一个只有 `fvar` 表的最小 SFNT。
 *
 * 目录 12 字节 + 一条 16 字节 record = 28；`fvar` 头 16 + 每轴 20。
 * 其余字段（checksum / 表体）对这段探测逻辑没有意义，留 0。
 */
function fakeSfnt(axisTags: string[]): ArrayBuffer {
  const axisSize = 20;
  const fvarLen = 16 + axisTags.length * axisSize;
  const buf = new ArrayBuffer(28 + fvarLen);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, 1); // numTables
  u8.set([0x66, 0x76, 0x61, 0x72], 12); // 'fvar'
  dv.setUint32(20, 28); // 表偏移
  dv.setUint32(24, fvarLen); // 表长度
  dv.setUint16(28 + 4, 16); // axesArrayOffset
  dv.setUint16(28 + 8, axisTags.length); // axisCount
  dv.setUint16(28 + 10, axisSize); // axisSize
  axisTags.forEach((tag, i) => {
    const p = 28 + 16 + i * axisSize;
    for (let c = 0; c < 4; c += 1) u8[p + c] = tag.charCodeAt(c);
  });
  return buf;
}

function ttfBytes(): ArrayBuffer {
  const b = readFileSync(new URL('../../public/fonts/inter-latin-400.ttf', import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe('fontHasWeightAxis', () => {
  it('静态字体（Inter）没有 wght 轴', () => {
    expect(fontHasWeightAxis(ttfBytes())).toBe(false);
  });

  it('带 wght 的 fvar 认成变量字体', () => {
    expect(fontHasWeightAxis(fakeSfnt(['wght']))).toBe(true);
  });

  it('只有别的轴（如 wdth）不算 —— 不能靠它救合成粗体', () => {
    expect(fontHasWeightAxis(fakeSfnt(['wdth']))).toBe(false);
  });

  it('wght 在第二根轴也能认出来', () => {
    expect(fontHasWeightAxis(fakeSfnt(['wdth', 'wght']))).toBe(true);
  });

  it('截断 / 垃圾字节一律当「没有」，不抛异常', () => {
    expect(fontHasWeightAxis(new ArrayBuffer(0))).toBe(false);
    expect(fontHasWeightAxis(new ArrayBuffer(8))).toBe(false);
    const broken = new Uint8Array(64);
    broken.set([0x66, 0x76, 0x61, 0x72], 12);
    expect(fontHasWeightAxis(broken.buffer)).toBe(false);
  });
});
