import { describe, expect, it } from 'vitest';
import {
  SPEED_CURVE_KEY,
  baseSpeedOf,
  hasSpeedCurve,
  mediaOffsetOf,
  mediaTimeOf,
  minSpeedOf,
  sourceRangeOf,
  speedAt,
  speedIntegralOf,
  type SpeedCarrier,
} from '../../src/core/speed';
import { evalCurve, integralCurve, type Curve } from '../../src/core/curve';
import { ProjectStore } from '../../src/core/project-store';
import {
  defaultProject,
  newId,
  type Project,
  type SourceClip,
  type VisualTrack,
} from '../../src/core/schema';
import { spanFromVideoClip } from '../../src/core/audio-plan';

/**
 * `core/speed.ts` —— 变速的**唯一**数学。
 *
 * 这里的判据分两类：
 *   1. **常速必须与改造前逐字节相同**（`srcIn + Δt × speed`）：那条路径是所有
 *      既有工程的画面，动一点就是全量回归。
 *   2. **曲线按积分走**：速度随时间变时，素材时间是 `∫v`，不是 `Δt × 当前速度`。
 *      写错的形态很具体 —— 变慢之后画面「跳一下」、或者与音频越走越远。
 */

const clip = (over: Partial<SourceClip> = {}, src: Partial<{ srcIn: number; speed: number }> = {}): SourceClip => ({
  kind: 'source',
  id: newId(),
  start: 2,
  end: 8,
  label: 'v',
  fadeSec: 0,
  curves: {},
  source: { type: 'video', assetId: 'v1', srcIn: src.srcIn ?? 0, speed: src.speed ?? 1 },
  blend: 'normal',
  opacity: 1,
  transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
  fit: 'cover',
  ...over,
});

const ramp = (from: number, to: number): Curve => ({
  keys: [
    { t: 0, v: from, interp: 'linear' },
    { t: 6, v: to, interp: 'linear' },
  ],
});

describe('常速：与改造前的公式逐项相同', () => {
  it('1× 时素材时间 = srcIn + 片内秒数', () => {
    const c = clip({}, { srcIn: 1.5 });
    expect(mediaTimeOf(c, 2)).toBeCloseTo(1.5, 12);
    expect(mediaTimeOf(c, 5)).toBeCloseTo(4.5, 12);
  });

  it('2× 时翻倍；0.5× 时减半', () => {
    expect(mediaTimeOf(clip({}, { srcIn: 2, speed: 2 }), 5)).toBeCloseTo(8, 12);
    expect(mediaTimeOf(clip({}, { srcIn: 2, speed: 0.5 }), 5)).toBeCloseTo(3.5, 12);
  });

  it('t < start（转场预热）钳到 0，不产生负时间', () => {
    expect(mediaTimeOf(clip({}, { srcIn: 3 }), 1)).toBeCloseTo(3, 12);
  });

  it('非正静态速度按 1 处理（倒放只走曲线）', () => {
    expect(baseSpeedOf(clip({}, { speed: 0 }))).toBe(1);
    expect(baseSpeedOf(clip({}, { speed: -2 }))).toBe(1);
    expect(baseSpeedOf(clip({}, { speed: 3 }))).toBe(3);
  });

  it('没有曲线时 hasSpeedCurve = false，speedAt 等于基值', () => {
    const c = clip({}, { speed: 4 });
    expect(hasSpeedCurve(c)).toBe(false);
    expect(speedAt(c, 5)).toBe(4);
  });
});

describe('曲线：媒体时间是速度的积分', () => {
  it('1× → 3× 的线性斜坡，6 秒片段的素材时长 = 梯形面积', () => {
    const c = clip({ curves: { [SPEED_CURVE_KEY]: ramp(1, 3) } });
    // ∫(1→3) 在 6 秒上 = (1 + 3) / 2 × 6 = 12
    expect(mediaOffsetOf(c, 8)).toBeCloseTo(12, 6);
    // 片内 3 秒处：∫(1→3) 前 3 秒 = (1 + 2) / 2 × 3 = 4.5
    expect(mediaOffsetOf(c, 5)).toBeCloseTo(4.5, 6);
  });

  it('曲线存在时基值不参与求值（曲线是唯一真源）', () => {
    const c = clip({ curves: { [SPEED_CURVE_KEY]: ramp(2, 2) } }, { speed: 0.5 });
    expect(speedAt(c, 4)).toBe(2);
    expect(mediaOffsetOf(c, 8)).toBeCloseTo(12, 6);
  });

  it('负速：媒体时间往回走，srcIn 是起点处的时间', () => {
    const c = clip({ curves: { [SPEED_CURVE_KEY]: ramp(-1, -1) } }, { srcIn: 10 });
    expect(mediaTimeOf(c, 2)).toBeCloseTo(10, 6);
    expect(mediaTimeOf(c, 5)).toBeCloseTo(7, 6);
    expect(mediaTimeOf(c, 8)).toBeCloseTo(4, 6);
  });

  it('正负混合：先前进再倒回，sourceRange 覆盖折返点', () => {
    // 2 → -3 的斜坡，片段 [2,8]（本地 0..6）：t=2.4 处速度归零，之前前进、之后倒回
    const c = clip({ curves: { [SPEED_CURVE_KEY]: ramp(2, -3) } }, { srcIn: 6 });
    const range = sourceRangeOf(c);
    // 折返点（∫ 最大）在中途，末端的媒体时间反而回到了起始之前
    expect(range.to).toBeGreaterThan(6);
    expect(range.from).toBeLessThan(6);
    // 端点：∫(2→-3) 全程 = (2-3)/2 × 6 = -3
    expect(mediaTimeOf(c, 8)).toBeCloseTo(3, 6);
  });

  it('锚到拍的曲线用 grid 换算（不传 grid 时按相对片段起点）', () => {
    const c = clip({
      curves: {
        [SPEED_CURVE_KEY]: {
          keys: [{ t: 0, v: 2, interp: 'linear' }],
          beatAnchor: { beat: 4 },
        },
      },
    });
    const grid = { bpm: 60, offset: 0, beatsPerBar: 4 };
    // beat 4 @ 60 BPM = 4s（相对片段起点 → 绝对 6s）。片段 [2,8] 全程 2×。
    expect(mediaOffsetOf(c, 8, grid)).toBeCloseTo(12, 6);
  });

  it('stop 曲线：只在前半段消耗素材', () => {
    const c = clip({
      curves: {
        [SPEED_CURVE_KEY]: {
          keys: [
            { t: 0, v: 1, interp: 'step' },
            { t: 3, v: 4, interp: 'step' },
          ],
        },
      },
    });
    expect(mediaOffsetOf(c, 5)).toBeCloseTo(3, 6); // 前 3 秒 × 1
    expect(mediaOffsetOf(c, 8)).toBeCloseTo(3 + 3 * 4, 6);
  });

  it('minSpeedOf 给出区间下界（倒放识别）', () => {
    expect(minSpeedOf(clip({ curves: { [SPEED_CURVE_KEY]: ramp(2, -1) } }))).toBeLessThan(0);
    expect(minSpeedOf(clip({ curves: { [SPEED_CURVE_KEY]: ramp(0.5, 3) } }))).toBeCloseTo(0.5, 6);
    expect(minSpeedOf(clip({}, { speed: 2 }))).toBe(2);
  });

  it('反向区间积分为负（trim 往回拖靠它）', () => {
    const c = clip({ curves: { [SPEED_CURVE_KEY]: ramp(1, 3) } });
    expect(speedIntegralOf(c, 5, 2)).toBeCloseTo(-4.5, 6);
  });
});

describe('integralCurve：与逐帧求值收敛到同一个数', () => {
  const numeric = (c: Curve, from: number, to: number, steps = 4000): number => {
    // 中点法：与求值器共用 evalCurve（刻意不共用积分实现）
    const h = (to - from) / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += evalCurve(c, from + (i + 0.5) * h, { clipStart: 0 }) * h;
    return sum;
  };

  const cases: { name: string; curve: Curve }[] = [
    {
      name: 'linear',
      curve: { keys: [{ t: 0, v: 0, interp: 'linear' }, { t: 2, v: 4, interp: 'linear' }] },
    },
    {
      name: 'smooth',
      curve: { keys: [{ t: 0, v: 1, interp: 'smooth' }, { t: 2, v: 5, interp: 'smooth' }] },
    },
    {
      name: 'step',
      curve: { keys: [{ t: 0, v: 1, interp: 'step' }, { t: 1.5, v: 3, interp: 'step' }] },
    },
    {
      name: 'bezier',
      curve: {
        keys: [
          { t: 0, v: 0, interp: 'bezier', hOut: [1, 2] },
          { t: 3, v: 4, interp: 'linear', hIn: [-1, 0] },
        ],
      },
    },
  ];

  for (const { name, curve } of cases) {
    it(`${name}：闭式 / Simpson 与数值积分一致`, () => {
      const exact = integralCurve(curve, 0, 3, { clipStart: 0 });
      expect(Math.abs(exact - numeric(curve, 0, 3))).toBeLessThan(0.02);
    });
  }

  it('key 之前 / 之后是平台值', () => {
    const curve: Curve = { keys: [{ t: 1, v: 2, interp: 'linear' }, { t: 2, v: 4, interp: 'linear' }] };
    // [0,1] 平台 2 → 2；[1,2] 梯形 3；[2,3] 平台 4 → 4
    expect(integralCurve(curve, 0, 3, { clipStart: 0 })).toBeCloseTo(2 + 3 + 4, 9);
  });
});

/* ------------------------------------------------------------------ store */

function projectWith(clip: SourceClip, durationSec = 10): Project {
  const p = defaultProject('变速');
  p.duration = 60;
  p.assets['v1'] = { id: 'v1', kind: 'video', name: 'v.mp4', durationSec };
  p.tracks.push({ kind: 'visual', id: 'v1t', name: 'V1', enabled: true, clips: [clip] } as VisualTrack);
  return p;
}

describe('ProjectStore.setClipSpeed：保持长度，素材不够才缩短', () => {
  it('2×：片段边界不动、srcIn 不动', () => {
    const c = clip({ start: 1, end: 5 }, { srcIn: 1, speed: 1 });
    const store = new ProjectStore(projectWith(c, 60));
    store.setClipSpeed(c.id, 2);
    const got = store.findClip(c.id)!.clip as SourceClip;
    expect(got.source).toMatchObject({ speed: 2, srcIn: 1 });
    expect(got.start).toBe(1);
    expect(got.end).toBe(5);
  });

  it('慢放也不改长度（需要的素材更少）', () => {
    const c = clip({ start: 1, end: 5 });
    const store = new ProjectStore(projectWith(c, 60));
    store.setClipSpeed(c.id, 0.25);
    const got = store.findClip(c.id)!.clip as SourceClip;
    expect(got.end).toBe(5);
  });

  it('加速后素材不够 → 片段缩短到用完为止', () => {
    // 素材 10s、srcIn 2、片段 4s；4× 需要 16s，可用只有 8s → 长度 2s
    const c = clip({ start: 1, end: 5 }, { srcIn: 2, speed: 1 });
    const store = new ProjectStore(projectWith(c, 10));
    store.setClipSpeed(c.id, 4);
    const got = store.findClip(c.id)!.clip as SourceClip;
    expect(got.start).toBe(1);
    expect(got.end).toBeCloseTo(3, 6);
  });

  it('素材时长未知时不缩短（无从判断）', () => {
    const p = defaultProject('变速');
    const c = clip({ start: 1, end: 5 });
    p.tracks.push({ kind: 'visual', id: 'v1t', name: 'V1', enabled: true, clips: [c] } as VisualTrack);
    const store = new ProjectStore(p);
    store.setClipSpeed(c.id, 50);
    expect((store.findClip(c.id)!.clip as SourceClip).end).toBe(5);
  });

  it('写常速会清掉 speed 曲线（曲线是唯一真源）', () => {
    const c = clip({ curves: { [SPEED_CURVE_KEY]: ramp(1, 3) } });
    const store = new ProjectStore(projectWith(c, 60));
    store.setClipSpeed(c.id, 2);
    const got = store.findClip(c.id)!.clip as SourceClip;
    expect(got.curves[SPEED_CURVE_KEY]).toBeUndefined();
    expect(got.source).toMatchObject({ speed: 2 });
  });

  it('非正速度 / 非视频片段：不动', () => {
    const c = clip({});
    const store = new ProjectStore(projectWith(c, 60));
    store.setClipSpeed(c.id, 0);
    expect((store.findClip(c.id)!.clip as SourceClip).source).toMatchObject({ speed: 1 });

    const solid: SourceClip = { ...clip({}), source: { type: 'solid', color: '#000' } };
    const store2 = new ProjectStore(projectWith(solid, 60));
    store2.setClipSpeed(solid.id, 3);
    expect((store2.findClip(solid.id)!.clip as SourceClip).source.type).toBe('solid');
  });
});

describe('曲线下 trim / split 用积分', () => {
  it('切分：右半段 srcIn = 原 srcIn + 切点前的积分', () => {
    const c = clip({ start: 0, end: 6, curves: { [SPEED_CURVE_KEY]: ramp(1, 3) } }, { srcIn: 1 });
    const store = new ProjectStore(projectWith(c, 60));
    expect(store.splitClipAt('v1t', c.id, 3)).toBe(true);
    const clips = (store.track('v1t')!.clips as SourceClip[]).sort((a, b) => a.start - b.start);
    expect(clips).toHaveLength(2);
    // ∫(1→3) 前 3 秒 = 4.5
    expect(clips[1]!.source).toMatchObject({ srcIn: 1 + 4.5 });
  });

  it('拖左边界：srcIn 跟着曲线积分走（不是 Δ × 基值）', () => {
    // 曲线 1→3，起点从 0 拖到 3：消耗 ∫[0,3] = 4.5
    const c = clip({ start: 0, end: 6, curves: { [SPEED_CURVE_KEY]: ramp(1, 3) } }, { srcIn: 0, speed: 1 });
    const store = new ProjectStore(projectWith(c, 60));
    store.liveResizeClip('v1t', c.id, 'start', 3);
    const got = store.findClip(c.id)!.clip as SourceClip;
    expect(got.start).toBeCloseTo(3, 9);
    expect((got.source as { srcIn: number }).srcIn).toBeCloseTo(4.5, 6);
  });
});

describe('audio-plan：变速跟随与倒放静音', () => {
  it('速度曲线透传，srcRange 覆盖整段', () => {
    // 曲线 key 铺满片段（0..6），1× → 2× 的斜坡：∫ = 1.5 × 6 = 9
    const c = clip({ start: 0, end: 6, curves: { [SPEED_CURVE_KEY]: ramp(1, 2) } }, { srcIn: 0 });
    const span = spanFromVideoClip(c, true)!;
    expect(span.speedCurve).toBeDefined();
    expect(span.reversed).toBe(false);
    expect(span.srcRange!.from).toBeCloseTo(0, 6);
    expect(span.srcRange!.to).toBeCloseTo(9, 6);
  });

  it('区间内有负速 → reversed（预览与导出都静音）', () => {
    const c = clip({ start: 0, end: 4, curves: { [SPEED_CURVE_KEY]: ramp(1, -1) } }, { srcIn: 5 });
    expect(spanFromVideoClip(c, true)!.reversed).toBe(true);
  });

  it('常速 span 不带曲线，也没被标成 reversed', () => {
    const span = spanFromVideoClip(clip({}, { speed: 2 }), true)!;
    expect(span.speedCurve).toBeUndefined();
    expect(span.reversed).toBe(false);
    expect(span.srcRange).toEqual({ from: 0, to: 12 });
  });
});

/** 类型守卫：确保测试用的片段形状真的能喂给 SpeedCarrier（编译期）。 */
const _carrier: SpeedCarrier = clip({});
void _carrier;
