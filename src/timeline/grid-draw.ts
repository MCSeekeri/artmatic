/**
 * grid-draw.ts — Canvas2D 标尺 / 网格 / 波形 / 播放头刻度绘制。
 *
 * 网格间距与吸附步长同源：都读 core/time.ts 的 SNAP_MODES 步长
 * （splitter 的双表债在这里没有生存空间）。
 * 波形画在网格 canvas 的音频轨行区域里，片段 DOM 之上是透明的。
 */

import { beatDur, barDur, type BeatGrid } from '../core/time';
import type { Project } from '../core/schema';
import type { WaveformData } from '../audio/decode';
import { xOfTime, RULER_HEIGHT, ROW_HEIGHT } from './view-model';

const COLOR_BAR = 'rgba(232, 235, 240, 0.28)';
const COLOR_BEAT = 'rgba(232, 235, 240, 0.08)';
const COLOR_TEXT = '#aab2c0';
const COLOR_WAVE = 'rgba(91, 157, 255, 0.55)';
const COLOR_WAVE_CENTER = 'rgba(91, 157, 255, 0.18)';

export function drawRuler(
  canvas: HTMLCanvasElement,
  project: Project,
  pxPerBeat: number,
  dpr: number,
): void {
  const g = project.beatGrid;
  const w = Math.ceil(xOfTime(project.duration, pxPerBeat, g)) + 2;
  if (canvas.width !== w * dpr || canvas.height !== RULER_HEIGHT * dpr) {
    canvas.width = w * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${RULER_HEIGHT}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, RULER_HEIGHT);
  ctx.fillStyle = '#16191f';
  ctx.fillRect(0, 0, w, RULER_HEIGHT);

  const bpb = g.beatsPerBar;
  const beatPx = pxPerBeat;
  // 缩得太小时只画 2/4/8 拍一格
  let stepBeats = 1;
  while (beatPx * stepBeats < 44) stepBeats *= 2;

  ctx.font = '10px Cascadia Code, Consolas, monospace';
  ctx.textBaseline = 'top';
  const beatD = beatDur(g);
  const totalBeats = Math.ceil(project.duration / beatD) + 1;

  for (let b = 0; b <= totalBeats; b += stepBeats) {
    const t = b * beatD;
    if (t > project.duration) break;
    const x = Math.round(xOfTime(t, pxPerBeat, g)) + 0.5;
    const isBar = b % bpb === 0;
    ctx.strokeStyle = isBar ? COLOR_BAR : COLOR_BEAT;
    ctx.beginPath();
    ctx.moveTo(x, isBar ? 6 : 16);
    ctx.lineTo(x, RULER_HEIGHT);
    ctx.stroke();
    if (isBar) {
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(String(Math.round(b / bpb) + 1), x + 4, 4);
    }
  }
  // 工程起点（t=0 可能在第 0 拍之后，如果 offset<0）
  ctx.strokeStyle = 'rgba(81, 207, 138, 0.7)';
  const x0 = Math.round(xOfTime(0, pxPerBeat, g)) + 0.5;
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(x0, RULER_HEIGHT);
  ctx.stroke();
}

export interface GridTrackRow {
  kind: 'visual' | 'audio';
  /** 音频轨要画的片段（资产 → 波形）。 */
  waveClips: { start: number; end: number; srcIn: number; assetId: string }[];
}

export function drawGrid(
  canvas: HTMLCanvasElement,
  project: Project,
  pxPerBeat: number,
  rows: GridTrackRow[],
  waveforms: Record<string, WaveformData>,
  dpr: number,
): void {
  const g = project.beatGrid;
  const w = Math.ceil(xOfTime(project.duration, pxPerBeat, g)) + 2;
  const h = rows.length * ROW_HEIGHT;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, w, h);

  // 行底色与分隔线
  rows.forEach((row, i) => {
    const y = i * ROW_HEIGHT;
    ctx.fillStyle = row.kind === 'audio' ? 'rgba(38, 43, 54, 0.45)' : 'rgba(29, 33, 41, 0.45)';
    ctx.fillRect(0, y, w, ROW_HEIGHT);
    ctx.strokeStyle = 'rgba(50, 57, 72, 0.8)';
    ctx.beginPath();
    ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
    ctx.lineTo(w, y + ROW_HEIGHT - 0.5);
    ctx.stroke();
  });

  // 波形（画在拍线之前，线叠在上面便于读格）
  rows.forEach((row, i) => {
    if (row.kind !== 'audio') return;
    const yMid = i * ROW_HEIGHT + ROW_HEIGHT / 2;
    const amp = ROW_HEIGHT / 2 - 4;
    for (const clip of row.waveClips) {
      const wf = waveforms[clip.assetId];
      if (!wf) continue;
      const x0 = xOfTime(clip.start, pxPerBeat, g);
      const x1 = xOfTime(clip.end, pxPerBeat, g);
      ctx.fillStyle = COLOR_WAVE_CENTER;
      ctx.fillRect(x0, yMid, x1 - x0, 1);
      ctx.strokeStyle = COLOR_WAVE;
      ctx.beginPath();
      for (let x = Math.max(0, Math.floor(x0)); x < x1; x++) {
        const t = clip.srcIn + (x - x0) / (pxPerBeat / beatDur(g));
        const b = Math.floor(t / wf.bucketSec);
        if (b < 0 || b >= wf.length) continue;
        const lo = wf.buckets[b * 2]!;
        const hi = wf.buckets[b * 2 + 1]!;
        ctx.moveTo(x + 0.5, yMid - hi * amp);
        ctx.lineTo(x + 0.5, yMid - lo * amp + 0.5);
      }
      ctx.stroke();
    }
  });

  // 拍线
  const beatD = beatDur(g);
  const bpb = g.beatsPerBar;
  let stepBeats = 1;
  while (pxPerBeat * stepBeats < 22) stepBeats *= 2;
  const totalBeats = Math.ceil(project.duration / beatD) + 1;
  for (let b = 0; b <= totalBeats; b += stepBeats) {
    const t = b * beatD;
    if (t > project.duration) break;
    const x = Math.round(xOfTime(t, pxPerBeat, g)) + 0.5;
    ctx.strokeStyle = b % bpb === 0 ? COLOR_BAR : COLOR_BEAT;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}
