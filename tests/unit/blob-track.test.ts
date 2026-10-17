import { describe, expect, it } from 'vitest';
import {
  detectBlobs,
  emptyTrackState,
  jitteredView,
  makeSaliency,
  saliency,
  stepTracker,
  type Blob,
  type DetectOptions,
  type TrackOptions,
} from '../../src/core/blob-track';

/**
 * 斑点追踪的纯算法守卫。
 *
 * 这一层是「方框跟不跟得住」的全部逻辑，且**只依赖一块像素数组** ——
 * 所以它必须在这里被钉死，而不是靠 E2E 看截图。E2E 只负责「画面上真的有框」。
 */

const W = 160;
const H = 90;

function blankFrame(bg = 18): Uint8Array {
  const a = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    a[i * 4] = bg;
    a[i * 4 + 1] = bg;
    a[i * 4 + 2] = bg + 6;
    a[i * 4 + 3] = 255;
  }
  return a;
}

function paintRect(
  a: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      a[i] = rgb[0];
      a[i + 1] = rgb[1];
      a[i + 2] = rgb[2];
    }
  }
}

const DETECT: DetectOptions = {
  mode: 'contrast',
  sensitivity: 0.6,
  minSize: 0.04,
  maxSize: 0.9,
  maxBlobs: 8,
};

function blobsOf(a: Uint8Array, opts: DetectOptions = DETECT): Blob[] {
  const s = saliency(a, W, H, opts.mode, null, makeSaliency(W, H));
  return detectBlobs(s.map, W, H, opts);
}

describe('显著性 / 斑点检测', () => {
  it('黑底上的两个亮块各自成一个斑，中心落在块内', () => {
    const a = blankFrame();
    paintRect(a, 20, 20, 44, 44, [245, 245, 245]);
    paintRect(a, 100, 50, 132, 74, [245, 245, 245]);

    const blobs = blobsOf(a);
    expect(blobs.length).toBe(2);

    const near = (b: Blob, cx: number, cy: number): boolean =>
      Math.abs(b.cx - cx) < 0.06 && Math.abs(b.cy - cy) < 0.06;
    // 顺序不保证（按面积×锐度排序），所以用「存在一个近似中心的」判定。
    expect(blobs.some((b) => near(b, 32 / W, 32 / H))).toBe(true);
    expect(blobs.some((b) => near(b, 116 / W, 62 / H))).toBe(true);
  });

  it('均匀画面不产生任何斑', () => {
    expect(blobsOf(blankFrame(120))).toHaveLength(0);
  });

  it('灵敏度越高，检出的斑不会更少', () => {
    const a = blankFrame(60);
    paintRect(a, 30, 30, 60, 60, [250, 250, 250]);
    paintRect(a, 100, 40, 120, 60, [96, 96, 96]); // 弱对比

    const strict = blobsOf(a, { ...DETECT, sensitivity: 0 });
    const loose = blobsOf(a, { ...DETECT, sensitivity: 1 });
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  it('motion 模式在没有上一帧时回落到 contrast（第 0 帧不能是空的）', () => {
    const a = blankFrame();
    paintRect(a, 40, 30, 80, 70, [250, 250, 250]);
    const blobs = blobsOf(a, { ...DETECT, mode: 'motion' });
    expect(blobs.length).toBeGreaterThan(0);
  });
});

const TRACK: TrackOptions = {
  maxBoxes: 4,
  smoothness: 0.6,
  jitter: 0,
  hold: 2,
  labelCount: 5,
};

function blob(cx: number, cy: number, hw = 0.06, hh = 0.06, score = 0.6): Blob {
  return { cx, cy, hw, hh, area: hw * hh * 2, score };
}

describe('身份关联', () => {
  it('平移后保持同一个 id，并得到同向速度', () => {
    let state = stepTracker(emptyTrackState(), [blob(0.3, 0.5)], TRACK, 7);
    expect(state.boxes).toHaveLength(1);
    const id = state.boxes[0]!.id;

    state = stepTracker(state, [blob(0.34, 0.5)], TRACK, 7);
    expect(state.boxes).toHaveLength(1);
    expect(state.boxes[0]!.id).toBe(id);
    expect(state.boxes[0]!.vx).toBeGreaterThan(0);
  });

  it('丢失超过 hold 帧后消失', () => {
    let state = stepTracker(emptyTrackState(), [blob(0.5, 0.5)], { ...TRACK, hold: 2 }, 7);
    expect(state.boxes).toHaveLength(1);
    for (let i = 0; i < 3; i++) state = stepTracker(state, [], { ...TRACK, hold: 2 }, 7);
    expect(state.boxes).toHaveLength(0);
  });

  it('新目标数不超过 maxBoxes', () => {
    const many = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((x) => blob(x, 0.5));
    const state = stepTracker(emptyTrackState(), many, { ...TRACK, maxBoxes: 3 }, 7);
    expect(state.boxes).toHaveLength(3);
  });

  it('标签下标始终落在词库范围内', () => {
    const many = [0.2, 0.5, 0.8].map((x) => blob(x, 0.5));
    const state = stepTracker(emptyTrackState(), many, { ...TRACK, labelCount: 3 }, 11);
    for (const b of state.boxes) {
      expect(b.label).toBeGreaterThanOrEqual(0);
      expect(b.label).toBeLessThan(3);
    }
  });
});

describe('抖动视图', () => {
  const base = stepTracker(emptyTrackState(), [blob(0.5, 0.5)], TRACK, 3).boxes;

  it('同种子同帧完全一致', () => {
    const a = jitteredView(base, 1, 42, 17);
    const b = jitteredView(base, 1, 42, 17);
    expect(a).toEqual(b);
  });

  it('换帧会变（否则「每帧更新」看不出来）', () => {
    const a = jitteredView(base, 1, 42, 17)[0]!;
    const b = jitteredView(base, 1, 42, 18)[0]!;
    expect(a.cx !== b.cx || a.cy !== b.cy || a.hw !== b.hw || a.hh !== b.hh).toBe(true);
  });

  it('jitter=0 时原样返回', () => {
    expect(jitteredView(base, 0, 42, 17)).toBe(base);
  });
});
