import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_LIMITS,
  RANGE,
  applyMachine,
  checkImportSize,
  currentCapacity,
  deriveLimits,
  getLimits,
  mbToBytes,
  onLimitsChange,
  resetCapacity,
  sanitize,
  setLimits,
  type CapacityLimits,
  type MachineCapacity,
} from '../../src/core/capacity';

/** 开发机实测值（`node scripts/capacity.mjs`，2026-10-12）：16 GB 内存、8 GB 显存。 */
const DEV: MachineCapacity = {
  totalRamMB: 16065,
  freeRamMB: 2546,
  vramMB: 8188,
  freeVramMB: 6573,
  source: 'node+nvidia-smi',
};

/** 一台低端笔记本：可用内存紧、核显共享内存（显存探测不到）。 */
const LOW: MachineCapacity = {
  totalRamMB: 8192,
  freeRamMB: 1200,
  vramMB: null,
  freeVramMB: null,
  source: 'node',
};

const sum = (l: CapacityLimits) => l.videoTextureMB + l.textRasterMB + l.effectPoolMB + l.simStateMB;

beforeEach(() => resetCapacity());

describe('容量预算派生', () => {
  it('每一项都落在自己的安全区间里（探测值再离谱也不会越界）', () => {
    for (const m of [DEV, LOW, { ...DEV, vramMB: 1_000_000, freeRamMB: 1_000_000 }, { ...DEV, vramMB: 1, freeRamMB: 1 }]) {
      const l = deriveLimits(m);
      for (const key of Object.keys(DEFAULT_LIMITS) as (keyof CapacityLimits)[]) {
        const [lo, hi] = RANGE[key];
        expect(l[key], `${key} 应 >= ${lo}`).toBeGreaterThanOrEqual(lo);
        expect(l[key], `${key} 应 <= ${hi}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('显存越大，GPU 侧预算不减（单调）', () => {
    const small = deriveLimits({ ...DEV, vramMB: 2048 });
    const big = deriveLimits({ ...DEV, vramMB: 24576 });
    expect(big.videoTextureMB).toBeGreaterThan(small.videoTextureMB);
    expect(big.textRasterMB).toBeGreaterThanOrEqual(small.textRasterMB);
    expect(big.effectPoolMB).toBeGreaterThanOrEqual(small.effectPoolMB);
    // 大显存也不许一次吃掉半个卡：上限就是上限。
    expect(big.videoTextureMB).toBeLessThanOrEqual(2048);
  });

  it('显存探测不到时只退 GPU 侧，内存侧照常按可用量算', () => {
    const l = deriveLimits(LOW);
    expect(l.videoTextureMB).toBe(DEFAULT_LIMITS.videoTextureMB);
    expect(l.textRasterMB).toBe(DEFAULT_LIMITS.textRasterMB);
    // 内存侧仍然来自探测（可用 1200 MB × 25% = 300 MB，落在 [128, 2048]）
    expect(l.exportMemoryMB).toBe(300);
    expect(l.exportMemoryMB).not.toBe(DEFAULT_LIMITS.exportMemoryMB);
  });

  it('可用内存大于总量时不会算出超额预算（探测抖动 / 覆盖文件写错）', () => {
    const l = deriveLimits({ ...DEV, freeRamMB: 999_999 });
    expect(l.exportMemoryMB).toBeLessThanOrEqual(2048);
    expect(l.undoSteps).toBeLessThanOrEqual(200);
  });

  it('可用内存很少时也留得下能干活的下限（不会算出 0）', () => {
    const l = deriveLimits({ ...DEV, freeRamMB: 0 });
    expect(l.exportMemoryMB).toBeGreaterThanOrEqual(128);
    expect(l.undoSteps).toBeGreaterThanOrEqual(40);
  });

  it('开发机的这组值能覆盖「一帧 3 层 1080p 排版 + 几个视频素材」的实际用量', () => {
    const l = deriveLimits(DEV);
    // 1080p 一排版位图 8.3 MB ⇒ 预算至少罩得住一帧 3 层还剩余量
    expect(l.textRasterMB).toBeGreaterThan(3 * 8.3);
    // 1080p 视频一帧也是 8.3 MB ⇒ 至少留得下十几帧
    expect(l.videoTextureMB / 8.3).toBeGreaterThan(16);
    expect(sum(l)).toBeLessThanOrEqual(DEV.vramMB! * 0.25 + 1);
  });
});

describe('配置入口的防线', () => {
  it('垃圾输入一律丢弃，坏项保留默认值（配置打错不该让页面起不来）', () => {
    const l = sanitize({
      videoTextureMB: Number.NaN,
      textRasterMB: -5,
      effectPoolMB: '256' as unknown as number,
      simStateMB: 0,
      // 未知键（配置文件手写的常见错误）：不认识就忽略，不能带进结果。
      unknownKey: 123,
    } as unknown as Partial<CapacityLimits>);
    expect(l.videoTextureMB).toBe(DEFAULT_LIMITS.videoTextureMB);
    expect(l.textRasterMB).toBe(DEFAULT_LIMITS.textRasterMB);
    expect(l.effectPoolMB).toBe(DEFAULT_LIMITS.effectPoolMB);
    expect(l.simStateMB).toBe(DEFAULT_LIMITS.simStateMB);
  });

  it('超范围的输入被夹到自己那一项的区间里', () => {
    expect(sanitize({ videoTextureMB: 10 ** 9 }).videoTextureMB).toBe(RANGE.videoTextureMB[1]);
    expect(sanitize({ undoSteps: 1 }).undoSteps).toBe(RANGE.undoSteps[0]);
  });

  it('空补丁 == 出厂默认（探测不到时的行为与改造前一致）', () => {
    expect(sanitize({})).toEqual(DEFAULT_LIMITS);
  });
});

describe('运行期持有', () => {
  it('applyMachine 写进派生值，setLimits 只覆盖给到的字段', () => {
    applyMachine(DEV);
    const derived = deriveLimits(DEV);
    expect(getLimits().videoTextureMB).toBe(derived.videoTextureMB);

    setLimits({ videoTextureMB: 123 });
    expect(getLimits().videoTextureMB).toBe(123);
    expect(getLimits().textRasterMB).toBe(derived.textRasterMB);
  });

  it('写入会通知订阅者，且通知里读到的已经是新值', () => {
    let seen = 0;
    let during = 0;
    const off = onLimitsChange(() => {
      seen += 1;
      during = getLimits().exportMemoryMB;
    });
    applyMachine(DEV);
    expect(seen).toBe(1);
    expect(during).toBe(getLimits().exportMemoryMB);
    off();
    setLimits({ exportMemoryMB: 777 });
    expect(seen).toBe(1); // 退订之后不再收到
  });

  it('覆盖文件里的显式 limits 优先于派生值', () => {
    applyMachine(DEV, { videoTextureMB: 64 });
    expect(getLimits().videoTextureMB).toBe(64);
    expect(currentCapacity().machine?.source).toBe(DEV.source);
  });

  it('mbToBytes 是 MB → 字节的唯一换算处', () => {
    expect(mbToBytes(1)).toBe(1024 * 1024);
    expect(mbToBytes(1.5)).toBe(1572864);
  });
});

describe('导入体积闸门', () => {
  it('等于上限放行，超一个字节就拒', () => {
    expect(checkImportSize(mbToBytes(192), 192)).toEqual({ ok: true });
    const over = checkImportSize(mbToBytes(192) + 1, 192);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.sizeBytes).toBe(mbToBytes(192) + 1);
      expect(over.limitBytes).toBe(mbToBytes(192));
    }
  });

  it('空文件与非有限数都不拦（拒绝它们该由解码器说了算）', () => {
    expect(checkImportSize(0, 8)).toEqual({ ok: true });
    expect(checkImportSize(Number.NaN, 8)).toEqual({ ok: true });
  });
});
