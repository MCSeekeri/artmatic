/**
 * blob-track.ts — 斑点追踪的**纯算法层**（无 DOM / 无 WebGL，可单测）。
 *
 * 「方框跟踪」特效的伪跟踪就在这里：显著性图 → 连通域斑点 → 跨帧身份关联 →
 * 平滑/外推。它只吃一块低分辨率像素（探针帧，见 `engine/box-tracker.ts`），
 * 产出归一化坐标下的方框列表，不碰绘制、不碰 GL。
 *
 * ## 为什么不用现成库
 *
 * `OpenCV.js`（Apache-2.0，wasm ≈8MB）与 `jsfeat`（MIT，2013 后停更）、
 * `tracking.js`（BSD，停更）都能做连通域/特征，但没有一个能塞进「一个特效」的
 * 体积与延迟预算，而且它们的输出不是我们要的「稳定 ID + 归一化方框」。
 * 这里的实现约 250 行，全部可单测。
 *
 * ## 确定性
 *
 * 全部随机走 `core/prng.ts`（`hashSeed` / `mulberry32`），种子由调用方按
 * `(工程种子, 实例, 帧号)` 派生。**同一次状态推进永远得到同一结果** ——
 * 追踪状态本身是有状态的（跨帧关联、速度、ID），seek 时的处置见
 * `engine/box-tracker.ts` 的 `reset()`。
 */

import { hashSeed, mulberry32 } from './prng';

/* --------------------------------------------------------------- 显著性 */

export type DetectMode = 'contrast' | 'motion' | 'luma' | 'saturation';

export interface Saliency {
  /** 逐像素显著性，0..1。 */
  map: Float32Array;
  /** 逐像素亮度 —— `motion` 模式下一帧要拿它做差。 */
  luma: Float32Array;
}

/**
 * 一块可复用的中间缓冲。60fps 下每帧新建 3 个 Float32Array 会制造 ~200KB/帧
 * 的垃圾，V8 扛得住，但没必要；服务层持有一份循环使用。
 */
export function makeSaliency(w: number, h: number): Saliency {
  return { map: new Float32Array(w * h), luma: new Float32Array(w * h) };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 从探针帧算显著性图。
 *
 * `rgba` 是 `gl.readPixels` 直接给出的 4 通道字节（UNPACK_ALIGNMENT=1 已设）。
 *
 * 四种检测偏好：
 * - `contrast`：`|L - 3×3 均值|`。对「画面里的物体」最通用 —— 物体会与周围
 *   背景产生局部亮度差，而大片均匀的天空/墙面不会。
 * - `motion`：`|L - 上一帧 L|`。只在画面里运动时才有值；**没有上一帧时回落到
 *   contrast**，否则第一帧一个框都不会有（seq 的第 0 帧尤其明显）。
 * - `luma`：直接取亮度。给「亮处就是目标」的素材（霓虹、星空、灯牌）。
 * - `saturation`：取饱和度。给「彩色物体在灰背景上」的素材。
 */
export function saliency(
  rgba: Uint8Array,
  w: number,
  h: number,
  mode: DetectMode,
  prevLuma: Float32Array | null,
  out: Saliency = makeSaliency(w, h),
): Saliency {
  const n = w * h;
  const { map, luma } = out;

  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    luma[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  if (mode === 'luma') {
    map.set(luma);
    return out;
  }
  if (mode === 'saturation') {
    // 不额外开一块 sat 缓冲：这个模式用得少，为它多一次 57KB 分配不划算。
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
      map[i] = mx <= 0 ? 0 : (mx - mn) / mx;
    }
    return out;
  }
  if (mode === 'motion' && prevLuma && prevLuma.length === n) {
    for (let i = 0; i < n; i++) map[i] = Math.abs(luma[i]! - prevLuma[i]!);
    return out;
  }

  // contrast（`motion` 的回落路径也走这里）：3×3 盒均值，边缘用钳位采样。
  //
  // **窗口要数实际样本数，不能除 9**：钳位之后边上只有 4 个（角）/ 6 个（边）
  // 样本，除 9 会在整圈边框上造出一条「假高对比」—— 实测均匀画面在四角
  // 得到 0.26 的显著性，于是检测器在边框上框出一圈假目标。
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < w - 1 ? x + 1 : x;
      let sum = 0;
      let cnt = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          sum += luma[row + xx]!;
          cnt++;
        }
      }
      const i = y * w + x;
      map[i] = Math.abs(luma[i]! - sum / cnt);
    }
  }
  return out;
}

/* --------------------------------------------------------------- 斑点 */

export interface DetectOptions {
  mode: DetectMode;
  /** 0 = 严格（只留最强的斑），1 = 宽松（弱对比也成斑）。 */
  sensitivity: number;
  /** 允许的最小方框边长（占画幅宽/高的比例）。 */
  minSize: number;
  /** 允许的最大方框边长（比例）。 */
  maxSize: number;
  maxBlobs: number;
}

export interface Blob {
  /** 中心（0..1，左上原点）。 */
  cx: number;
  cy: number;
  /** 半宽 / 半高（0..1）。 */
  hw: number;
  hh: number;
  /** 连通域面积占整幅的比例。 */
  area: number;
  /** 域内平均显著性（0..1）。越大越像「一个真目标」。 */
  score: number;
}

export function defaultDetectOptions(): DetectOptions {
  return { mode: 'contrast', sensitivity: 0.5, minSize: 0.04, maxSize: 0.7, maxBlobs: 6 };
}

/** 检测过程的中间读数（`BoxTracker.stats()` 用；不参与算法本身）。 */
export interface DetectDiag {
  mean: number;
  std: number;
  thr: number;
  /** 过阈值的网格单元数。0 = 阈值把所有东西都挡掉了。 */
  above: number;
  /** 去重前的候选峰数。 */
  raw: number;
}

/**
 * 斑点检测：**粗网格上的局部峰 + 向外生长**。
 *
 * ## 为什么不是「显著性阈值 + 连通域」
 *
 * 那不是没试过：`contrast` 给出的是**边缘**，连通域只会得到 1~2 像素宽的线，
 * 被尺寸过滤全丢（实测显著性峰值 0.04，却一个框都没有）；而画面里一旦有连成
 * 一片的结构（网格、栏杆、逆光轮廓），整幅会连成**一个**连通域，又被
 * `maxSize` 判成「背景」。两种失败方式都表现为「框不出现」，且不报错。
 *
 * 换成网格峰之后：
 * - 单元平均先把噪声抹平，峰的语义是「这一小块比周围更有内容」；
 * - 每个峰向外生长到能量衰减为止，框的尺寸自然贴着目标；
 * - 相连的结构仍会给出多个峰 —— 与真实检测器在密集场景里的表现一致。
 *
 * 阈值用 `mean + k·std` 而不是固定值：素材亮度差几十倍，固定阈值在暗素材上
 * 一个斑点都找不出来（用户看到的是「特效没反应」）。`k` 由灵敏度线性映射。
 *
 * 复杂度 O(w·h + 单元数²)：160×90 的探针上约 1.5 万次像素运算。
 */
export function detectBlobs(
  sal: Float32Array,
  w: number,
  h: number,
  opts: DetectOptions,
  diag?: DetectDiag,
): Blob[] {
  const n = w * h;
  if (n === 0) return [];

  // 1) 3×3 盒滤波：把边缘能量糊成一片「高细节区域」。
  //    同样按实际样本数平均（边缘的窗口不满 9 个，除 9 会造出一圈假能量）。
  const energy = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < w - 1 ? x + 1 : x;
      let sum = 0;
      let cnt = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          sum += sal[row + xx]!;
          cnt++;
        }
      }
      energy[y * w + x] = sum / cnt;
    }
  }

  // 2) 粗网格统计（约 8px 一格）。单元太大就变成「整幅一个峰」，
  //    太小则每个目标被切成几段 —— 8px 在 160 宽的探针上是实测折中。
  const GW = Math.min(40, Math.max(6, Math.round(w / 8)));
  const GH = Math.min(26, Math.max(4, Math.round(h / 8)));
  const cells = GW * GH;
  const cellE = new Float32Array(cells);
  const cellCx = new Float32Array(cells);
  const cellCy = new Float32Array(cells);

  for (let gy = 0; gy < GH; gy++) {
    const y0 = Math.floor((gy * h) / GH);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / GH));
    for (let gx = 0; gx < GW; gx++) {
      const x0 = Math.floor((gx * w) / GW);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / GW));
      let sum = 0;
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const e = energy[y * w + x]!;
          sum += e;
          sx += e * x;
          sy += e * y;
          count++;
        }
      }
      const idx = gy * GW + gx;
      cellE[idx] = count > 0 ? sum / count : 0;
      cellCx[idx] = sum > 1e-9 ? sx / sum / w : (x0 + x1) / 2 / w;
      cellCy[idx] = sum > 1e-9 ? sy / sum / h : (y0 + y1) / 2 / h;
    }
  }

  let cSum = 0;
  let cMax = 0;
  for (let i = 0; i < cells; i++) {
    cSum += cellE[i]!;
    if (cellE[i]! > cMax) cMax = cellE[i]!;
  }
  const mean = cSum / cells;
  let varSum = 0;
  for (let i = 0; i < cells; i++) {
    const d = cellE[i]! - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / cells);
  const sens = clamp01(opts.sensitivity);
  const k = 2.2 - 1.6 * sens;
  // 下限 0.0012（单元均值量级）：均匀画面上 std≈0，没有下限会把噪声判成斑。
  const thr = Math.max(mean + k * std, 0.0012);

  if (diag) {
    let above = 0;
    for (let i = 0; i < cells; i++) if (cellE[i]! >= thr) above++;
    diag.mean = mean;
    diag.std = std;
    diag.thr = thr;
    diag.above = above;
    diag.raw = 0;
  }

  // 3) 候选峰：按能量降序。同分时按格子下标，保证跨机器一致。
  const order: number[] = [];
  for (let i = 0; i < cells; i++) if (cellE[i]! >= thr) order.push(i);
  order.sort((a, b) => cellE[b]! - cellE[a]! || a - b);
  if (diag) diag.raw = order.length;

  const maxBlobs = Math.max(1, Math.round(opts.maxBlobs));
  const maxHalfW = Math.max(0.005, opts.maxSize / 2);
  const maxHalfH = Math.max(0.005, (opts.maxSize * w) / 2 / h);
  const minHalfW = Math.max(0.005, (opts.minSize * w) / 2 / w);
  const minHalfH = Math.max(0.005, (opts.minSize * w) / 2 / h);

  /*
   * 4) 区域生长：从峰出发，把「能量还够」的相邻单元并成一块。
   *
   * 一个目标在显著性图上通常不是一团实心，而是轮廓（`contrast` 给的是边缘）。
   * 生长取到的是**整块目标的包围盒**，中心落在轮廓中间 —— 这正是「框住一个
   * 物体」而不是「框住一条边」。
   *
   * 同一块区域只出一个框：生长过的单元被标记为已访问，后面落在这块上的峰
   * 直接跳过（密集场景里也不会出现「一个物体上叠四个框」）。
   */
  const visited = new Uint8Array(cells);
  const stack = new Int32Array(cells);
  const out: Blob[] = [];

  for (const c of order) {
    if (out.length >= maxBlobs) break;
    if (visited[c]) continue;
    const peak = cellE[c]!;
    /*
     * 生长阈值同时卡两道：
     * - `0.5·peak`：不许长进「明显比峰弱」的地方（否则整幅会连成一块）；
     * - `thr`：也不许长进「本来就算不上斑」的地方 —— 只卡 `0.5·peak` 时，
     *   软调照片（能量场很平）会从峰一路长到画面边缘，框变成整幅。
     */
    const grow = Math.max(0.5 * peak, thr);

    let sp = 0;
    stack[sp++] = c;
    visited[c] = 1;
    let sumE = 0;
    let sumX = 0;
    let sumY = 0;
    let minGx = GW;
    let maxGx = -1;
    let minGy = GH;
    let maxGy = -1;

    while (sp > 0) {
      const i = stack[--sp]!;
      const x = i % GW;
      const y = (i - x) / GW;
      const e = cellE[i]!;
      sumE += e;
      sumX += e * cellCx[i]!;
      sumY += e * cellCy[i]!;
      if (x < minGx) minGx = x;
      if (x > maxGx) maxGx = x;
      if (y < minGy) minGy = y;
      if (y > maxGy) maxGy = y;
      // 4 邻接：斜接会把两条交叉的线连成一整块，密集画面里会粘成一片。
      const nbs = [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, y > 0 ? i - GW : -1, y < GH - 1 ? i + GW : -1];
      for (const nb of nbs) {
        if (nb < 0 || visited[nb] || cellE[nb]! < grow) continue;
        visited[nb] = 1;
        stack[sp++] = nb;
      }
    }

    // 5) 框：区域包围盒（再夹进 min/max、夹进画面）。
    let hw = ((maxGx - minGx + 1) / 2) / GW;
    let hh = ((maxGy - minGy + 1) / 2) / GH;
    hw = Math.min(Math.max(hw, minHalfW), maxHalfW);
    hh = Math.min(Math.max(hh, minHalfH), maxHalfH);

    // 中心用能量加权质心：空心轮廓的包围盒中心可能落在空档里，
    // 质心则稳定落在「目标整体」上。
    const cx0 = sumE > 1e-9 ? sumX / sumE : cellCx[c]!;
    const cy0 = sumE > 1e-9 ? sumY / sumE : cellCy[c]!;
    const cx = Math.min(Math.max(cx0, hw), 1 - hw);
    const cy = Math.min(Math.max(cy0, hh), 1 - hh);

    // 7) 与已接受的框重叠太多就丢掉：亮区常常被切成几块相邻的簇，
    //    各给一个框的结果是「一堆框糊在同一处」，而空的地方一个框都没有。
    //    判据取「新框被覆盖的比例」，比中心距离稳定（大小悬殊的框也能判对）。
    const area = 4 * hw * hh;
    let covered = 0;
    for (const b of out) {
      const ix = Math.min(cx + hw, b.cx + b.hw) - Math.max(cx - hw, b.cx - b.hw);
      const iy = Math.min(cy + hh, b.cy + b.hh) - Math.max(cy - hh, b.cy - b.hh);
      if (ix > 0 && iy > 0) covered += ix * iy;
    }
    if (covered > 0.45 * area) continue;

    out.push({
      cx,
      cy,
      hw,
      hh,
      area,
      // 归一化到「最亮的那个峰」，置信率才有区分度。
      score: cMax > 1e-9 ? clamp01(peak / cMax) : 0,
    });
  }

  out.sort((a, b) => b.score - a.score || b.area - a.area);
  return out.slice(0, maxBlobs);
}

/* --------------------------------------------------------------- 关联 */

export interface TrackOptions {
  maxBoxes: number;
  /** 0 = 紧跟检测（跟得紧但抖），1 = 很稳（顺滑但会拖）。 */
  smoothness: number;
  /** 0..1，逐帧位置/尺寸抖动幅度（观感上的「检测噪声」）。 */
  jitter: number;
  /** 丢失后保留多少帧（按速度外推），超时消失。 */
  hold: number;
  /** 标签词库大小。核心不认识文案，只产出下标。 */
  labelCount: number;
}

export interface TrackBox {
  id: number;
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  /** 速度（归一化坐标 / 帧），只用于预测与丢失时的外推。 */
  vx: number;
  vy: number;
  /** 置信度 0..1，给叠层显示。 */
  conf: number;
  /** 连续命中帧数。 */
  age: number;
  /** 连续丢失帧数。 */
  lost: number;
  /** 标签在词库里的下标。 */
  label: number;
}

export interface TrackState {
  boxes: TrackBox[];
  nextId: number;
}

export function emptyTrackState(): TrackState {
  return { boxes: [], nextId: 1 };
}

export function defaultTrackOptions(): TrackOptions {
  return { maxBoxes: 6, smoothness: 0.6, jitter: 0.35, hold: 6, labelCount: 8 };
}

/** 关联的距离门限（归一化坐标）。超过这个距离就不认为是同一个物体。 */
const GATE = 0.3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 推进一帧：把本帧检出的斑点接到已有方框上。
 *
 * 匹配是**贪心最近邻**（不是匈牙利算法）：探针尺寸小、目标数 ≤12、且允许
 * 「认错再改回来」，一次全排列组合的收益抵不上它的代码量与不确定性。
 * 距离里掺了尺寸差，否则「两个大小悬殊的目标擦身而过」时 ID 会互换。
 */
export function stepTracker(
  state: TrackState,
  blobs: Blob[],
  opts: TrackOptions,
  seed: number,
): TrackState {
  const smooth = clamp01(opts.smoothness);
  // 平滑度越高，往检测值靠得越慢。下限 0.22 是为了「跳帧后一两帧内收敛」。
  const alpha = 0.22 + (1 - smooth) * 0.62;
  const maxBoxes = Math.max(1, Math.round(opts.maxBoxes));

  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < state.boxes.length; i++) {
    const b = state.boxes[i]!;
    // 用「上一帧位置 + 速度」预测，视频里匀速平移的物体才不会被甩掉。
    const px = b.cx + b.vx;
    const py = b.cy + b.vy;
    for (let j = 0; j < blobs.length; j++) {
      const d0 = blobs[j]!;
      const dx = d0.cx - px;
      const dy = d0.cy - py;
      const dist = Math.hypot(dx, dy);
      if (dist > GATE) continue;
      const sizePenalty = 0.5 * (Math.abs(d0.hw - b.hw) + Math.abs(d0.hh - b.hh));
      pairs.push({ i, j, d: dist + sizePenalty });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const usedPrev = new Set<number>();
  const usedDet = new Set<number>();
  const boxes: TrackBox[] = [];

  for (const { i, j } of pairs) {
    if (usedPrev.has(i) || usedDet.has(j)) continue;
    usedPrev.add(i);
    usedDet.add(j);
    const b = state.boxes[i]!;
    const d = blobs[j]!;
    const ncx = lerp(b.cx, d.cx, alpha);
    const ncy = lerp(b.cy, d.cy, alpha);
    const nhw = lerp(b.hw, d.hw, alpha);
    const nhh = lerp(b.hh, d.hh, alpha);
    // 速度也做一阶低通：直接把逐帧位移当速度会在抖动时爆掉。
    const vx = lerp(b.vx, ncx - b.cx, 0.5);
    const vy = lerp(b.vy, ncy - b.cy, 0.5);
    boxes.push({
      ...b,
      cx: ncx,
      cy: ncy,
      hw: nhw,
      hh: nhh,
      vx,
      vy,
      // 置信度：斑的锐度 + 跟踪时长（跟得越久越像「锁定」）。
      conf: clamp01(0.58 + 0.33 * d.score + 0.05 * Math.min(1, b.age / 30)),
      age: b.age + 1,
      lost: 0,
    });
  }

  // 丢失的：按速度外推，超时丢弃。外推是「框还在跟，但目标被挡了一下」的观感。
  for (let i = 0; i < state.boxes.length; i++) {
    if (usedPrev.has(i)) continue;
    const b = state.boxes[i]!;
    const lost = b.lost + 1;
    if (lost > opts.hold) continue;
    boxes.push({ ...b, cx: b.cx + b.vx, cy: b.cy + b.vy, lost, vx: b.vx * 0.9, vy: b.vy * 0.9 });
  }

  // 新目标：只填空位。满了就不加 —— 「越跑越多」比「少一个框」难看得多。
  let nextId = state.nextId;
  for (let j = 0; j < blobs.length; j++) {
    if (usedDet.has(j)) continue;
    if (boxes.length >= maxBoxes) break;
    const d = blobs[j]!;
    const rng = mulberry32(hashSeed(seed, 'label', nextId));
    boxes.push({
      id: nextId++,
      cx: d.cx,
      cy: d.cy,
      hw: d.hw,
      hh: d.hh,
      vx: 0,
      vy: 0,
      conf: clamp01(0.58 + 0.33 * d.score),
      age: 1,
      lost: 0,
      label: Math.floor(rng() * Math.max(1, Math.round(opts.labelCount))) % Math.max(1, Math.round(opts.labelCount)),
    });
  }

  // 超编：先丢丢失的，再丢最旧置信度最低的。
  if (boxes.length > maxBoxes) {
    boxes.sort((a, b) => (a.lost === b.lost ? b.conf - a.conf : a.lost - b.lost));
    boxes.length = maxBoxes;
  }

  // 夹进画面：外推与 pad 都可能把框推出边界。
  for (const b of boxes) {
    b.hw = Math.min(Math.max(b.hw, 0.01), 0.98);
    b.hh = Math.min(Math.max(b.hh, 0.01), 0.98);
    b.cx = Math.min(Math.max(b.cx, 0), 1);
    b.cy = Math.min(Math.max(b.cy, 0), 1);
  }

  return { boxes, nextId };
}

/**
 * 渲染用的抖动视图。
 *
 * **必须与状态分开**：把抖动写回状态会让速度估计开始追着自己的噪声跑，
 * 几秒后框会自己漂出画面。这里每次返回新数组，状态仍是平滑值。
 */
export function jitteredView(
  boxes: TrackBox[],
  jitter: number,
  seed: number,
  frame: number,
): TrackBox[] {
  const j = clamp01(jitter);
  if (j <= 0) return boxes;
  return boxes.map((b) => {
    const rng = mulberry32(hashSeed(seed, 'jit', b.id, frame));
    const dx = (rng() - 0.5) * 0.014 * j;
    const dy = (rng() - 0.5) * 0.014 * j;
    const dw = (rng() - 0.5) * 0.16 * j;
    const dh = (rng() - 0.5) * 0.16 * j;
    const hw = Math.max(0.01, b.hw * (1 + dw));
    const hh = Math.max(0.01, b.hh * (1 + dh));
    return {
      ...b,
      cx: Math.min(Math.max(b.cx + dx, hw * 0.5), 1 - hw * 0.5),
      cy: Math.min(Math.max(b.cy + dy, hh * 0.5), 1 - hh * 0.5),
      hw,
      hh,
    };
  });
}
