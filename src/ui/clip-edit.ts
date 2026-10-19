/**
 * clip-edit.ts — 片段参数读写与关键帧编辑的辅助函数。
 *
 * 曲线键约定（schema.ts 的注释是权威）：
 *   'opacity' / 'transform.x' / ... 作用于 SourceClip 的同名基值；
 *   `${instanceId}.${paramKey}`（B8）作用于特效实例参数。
 */

import { upsertKey, type Curve } from '../core/curve';
import { timeAtBeat, type BeatGrid } from '../core/time';
import type { AnyClip, SourceClip } from '../core/schema';

const TRANSFORM_PREFIX = 'transform.';

export function baseOf(clip: AnyClip, key: string): number {
  if (clip.kind !== 'source') return 0;
  if (key === 'opacity') return clip.opacity;
  if (key.startsWith(TRANSFORM_PREFIX)) {
    const f = key.slice(TRANSFORM_PREFIX.length) as keyof SourceClip['transform'];
    return clip.transform[f];
  }
  return 0;
}

export function setBase(clip: AnyClip, key: string, v: number): void {
  if (clip.kind !== 'source') return;
  if (key === 'opacity') {
    clip.opacity = v;
    return;
  }
  if (key.startsWith(TRANSFORM_PREFIX)) {
    const f = key.slice(TRANSFORM_PREFIX.length) as keyof SourceClip['transform'];
    clip.transform[f] = v;
  }
}

/** 在（绝对）时刻 t 给曲线的 key 打点；曲线不存在就创建。 */
export function upsertCurveKey(
  clip: AnyClip,
  key: string,
  v: number,
  t: number,
  beatAnchor: { beat: number } | null,
  grid: BeatGrid,
): void {
  const localT = beatAnchor ? t - timeAtBeat(beatAnchor.beat, grid) : t - clip.start;
  const cur: Curve | undefined = clip.curves[key];
  if (cur) {
    /*
     * 播放头处已有 key 时**只改值**，不覆盖 interp / handles。
     * 覆盖的形态是：用户把一段设成 step 或手调过贝塞尔手柄，随后拖一下滑杆，
     * 整条段静默退回匀速 —— 没有任何报错，只是动画变了。
     */
    const existing = cur.keys.find((k) => Math.abs(k.t - localT) <= 1e-3);
    cur.keys = upsertKey(
      cur.keys,
      existing ? { ...existing, v } : { t: localT, v, interp: 'linear' },
    );
    if (beatAnchor !== null || cur.beatAnchor == null) cur.beatAnchor = beatAnchor;
  } else {
    clip.curves[key] = { keys: [{ t: localT, v, interp: 'linear' }], beatAnchor };
  }
}
