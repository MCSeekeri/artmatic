/**
 * grid-draw.ts — Canvas2D 标尺 / 网格 / 波形 / 播放头刻度绘制。
 *
 * 网格间距与吸附步长同源：都读 core/time.ts 的 SNAP_MODES 步长
 * （splitter 的双表债在这里没有生存空间）。
 * 波形画在网格 canvas 的音频轨行区域里，片段 DOM 之上是透明的。
 *
 * **颜色全部来自 palette 参数**（`ui/tokens.ts` 的 `canvasPalette(spec)`）。
 * 这里曾经内联着一份与 CSS 变量同值的调色板副本——Canvas 写不了 `var(--x)`，
 * 于是改一次配色要改两处，改漏就是「面板变了、网格没变」的偏色。现在传参进来，
 * 物理上不可能不同步。
 */

import { beatDur, barDur, type BeatGrid } from '../core/time';
import type { Project } from '../core/schema';
import type { WaveformData } from '../audio/decode';
import type { CanvasPalette } from '../ui/tokens';
import { xOfTime, RULER_HEIGHT, ROW_HEIGHT } from './view-model';

export function drawRuler(
  canvas: HTMLCanvasElement,
  project: Project,
  pxPerBeat: number,
  dpr: number,
  palette: CanvasPalette,
  /** 画布至少这么宽（= 滚动视口宽），否则工程末尾右侧会露一条底色空档。 */
  minWidth = 0,
): void {
  const g = project.beatGrid;
  const w = Math.max(minWidth, Math.ceil(xOfTime(project.duration, pxPerBeat, g)) + 2);
  if (canvas.width !== w * dpr || canvas.height !== RULER_HEIGHT * dpr) {
    canvas.width = w * dpr;
    canvas.height = RULER_HEIGHT * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${RULER_HEIGHT}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, RULER_HEIGHT);
  ctx.fillStyle = palette.rulerBg;
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
    ctx.strokeStyle = isBar ? palette.barLine : palette.beatLine;
    ctx.beginPath();
    ctx.moveTo(x, isBar ? 6 : 16);
    ctx.lineTo(x, RULER_HEIGHT);
    ctx.stroke();
    if (isBar) {
      ctx.fillStyle = palette.rulerText;
      ctx.fillText(String(Math.round(b / bpb) + 1), x + 4, 4);
    }
  }
  // 工程起点（t=0 可能在第 0 拍之后，如果 offset<0）
  ctx.strokeStyle = palette.originLine;
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
  palette: CanvasPalette,
  /** 同 drawRuler：至少铺满滚动视口。 */
  minWidth = 0,
): void {
  const g = project.beatGrid;
  const w = Math.max(minWidth, Math.ceil(xOfTime(project.duration, pxPerBeat, g)) + 2);
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
  ctx.fillStyle = palette.gridBg;
  ctx.fillRect(0, 0, w, h);

  // 行底色与分隔线
  rows.forEach((row, i) => {
    const y = i * ROW_HEIGHT;
    ctx.fillStyle = row.kind === 'audio' ? palette.rowAudio : palette.rowVisual;
    ctx.fillRect(0, y, w, ROW_HEIGHT);
    ctx.strokeStyle = palette.rowLine;
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
      ctx.fillStyle = palette.waveCenter;
      ctx.fillRect(x0, yMid, x1 - x0, 1);
      ctx.strokeStyle = palette.waveBody;
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
    ctx.strokeStyle = b % bpb === 0 ? palette.barLine : palette.beatLine;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}
