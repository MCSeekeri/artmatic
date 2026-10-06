import { describe, expect, it } from 'vitest';
import { gifFrameDelays, gifFrameStep, planGif } from '../../src/exporters/gif-plan';

/**
 * GIF 导出的纯计算层。
 *
 * 这里钉的是**会咬人的两件事**，不是函数签名：
 *  1. 逐帧延迟必须**不累积取整误差** —— GIF 只能存整数厘秒，而「工程 60fps →
 *     GIF 12.5fps」这类换算里每帧真值都是无限小数。写错的表现是「片子比音乐慢
 *     半秒」，而画面本身完全正常，肉眼极难归因。
 *  2. 尺寸 / 抽帧 / 帧数三者必须自洽 —— 面板显示的帧数与真正写进文件的帧数
 *     来自同一个 plan，这里断的就是那个 plan 本身。
 */
describe('GIF 帧率与抽帧', () => {
  it('gifFrameStep：工程帧率 ÷ 目标帧率，四舍五入且至少 1', () => {
    // 60 → 12.5：4.8 → 5 帧抽 1 帧
    expect(gifFrameStep(60, 12.5)).toBe(5);
    // 60 → 20：正好 3
    expect(gifFrameStep(60, 20)).toBe(3);
    // 30 → 25：1.2 → 1（宁可密一点，也不许把帧插出来）
    expect(gifFrameStep(30, 25)).toBe(1);
    // 目标帧率高于工程帧率：仍然只能 1，绝不能返回 0 或小数
    expect(gifFrameStep(10, 25)).toBe(1);
    // 非法帧率不炸，回落到 1
    expect(gifFrameStep(60, 0)).toBe(1);
    expect(gifFrameStep(60, -5)).toBe(1);
  });

  it('gifFrameDelays：累加恰好等于工程时长（这正是差值法存在的理由）', () => {
    /*
     * 60fps 工程抽到 25fps → 步长 2，每帧真值 3.333… 厘秒。
     *
     * 逐帧取整（round(100·step/srcFps) = round(3.333) = 3cs）会**每一帧都少
     * 0.333cs**，300 帧下来累积漂掉 100cs = 整整 1 秒 —— 这类 bug 在静态截图里
     * 完全看不出来，只有「跟着音乐看」才会发现。
     */
    const srcFps = 60;
    const step = 2;
    const count = 300;
    const delays = gifFrameDelays(0, count, step, srcFps);

    const totalCs = delays.reduce((sum, ms) => sum + ms, 0) / 10;
    const wantCs = Math.round((100 * count * step) / srcFps);

    expect(delays).toHaveLength(count);
    expect(totalCs).toBe(wantCs); // 1000cs = 10s，精确

    // 反例守卫：确认这条断言真的能分辨两种算法（逐帧取整会差 100cs）。
    const naiveCs = count * Math.round((100 * step) / srcFps);
    expect(naiveCs).not.toBe(wantCs);
    expect(naiveCs).toBe(900);
  });

  it('gifFrameDelays：每帧都是 10ms 的整数倍（gifenc 会除以 10 存厘秒）', () => {
    const delays = gifFrameDelays(0, 50, 3, 30);
    for (const ms of delays) {
      expect(ms % 10, `delay=${ms}ms`).toBe(0);
      expect(ms).toBeGreaterThan(0);
    }
  });

  it('gifFrameDelays：零帧返回空数组，不返回 [0]', () => {
    expect(gifFrameDelays(0, 0, 5, 60)).toEqual([]);
  });

  it('gifFrameDelays：裁成两半分别导出，总时长与整段完全一致', () => {
    /*
     * 这是「起点也要过同一遍厘秒取整」的判据。
     *
     * 60fps、步长 2 → 每帧真值 3.333cs。如果第二半的起点直接拿 150 帧当基准
     * 而不过取整，两半拼起来就会差几厘秒 —— 单看每一半都"差不多对"，
     * 只有拼起来才看得出来。
     */
    const whole = gifFrameDelays(0, 150, 2, 60);
    const firstHalf = gifFrameDelays(0, 75, 2, 60);
    const secondHalf = gifFrameDelays(150, 75, 2, 60);
    const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

    expect(sum(whole)).toBe(5000); // 300 源帧 @60fps = 5 秒
    expect(sum(firstHalf) + sum(secondHalf)).toBe(sum(whole));
  });
});

describe('planGif', () => {
  const landscape = { w: 1920, h: 1080 };
  const portrait = { w: 1080, h: 1920 };

  it('横屏：高度按宽高比换算', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 60,
      duration: 24,
      width: 480,
      fps: 12.5,
    });
    expect(plan.size).toEqual({ w: 480, h: 270 });
  });

  it('竖屏：同样选 480 宽，得到的是 480×853 而不是 480×270', () => {
    const plan = planGif({
      srcSize: portrait,
      srcFps: 30,
      duration: 5,
      width: 480,
      fps: 12.5,
    });
    // 480 × 1920 / 1080 = 853.33 → 853
    expect(plan.size).toEqual({ w: 480, h: 853 });
  });

  it('24 秒 / 60fps / 12.5fps：288 帧，且总时长精确回到 24 秒', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 60,
      duration: 24,
      width: 480,
      fps: 12.5,
    });
    // 1440 源帧 ÷ 步长 5
    expect(plan.frameStep).toBe(5);
    expect(plan.frameCount).toBe(288);
    expect(plan.delaysMs).toHaveLength(288);
    const seconds = plan.delaysMs.reduce((a, b) => a + b, 0) / 1000;
    expect(seconds).toBeCloseTo(24, 3);
  });

  it('时长极短时仍然至少 1 帧（否则 sink 会产出只有 trailer 的空文件）', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 60,
      duration: 0,
      width: 480,
      fps: 12.5,
    });
    expect(plan.frameCount).toBeGreaterThanOrEqual(1);
    expect(plan.delaysMs).toHaveLength(1);
  });

  it('宽度下限是 2px，且不因 0 宽的工程分辨率而除以零', () => {
    const plan = planGif({
      srcSize: { w: 0, h: 0 },
      srcFps: 30,
      duration: 1,
      width: 1,
      fps: 12.5,
    });
    expect(plan.size.w).toBe(2);
    expect(plan.size.h).toBe(2);
    expect(Number.isFinite(plan.rawBytes)).toBe(true);
  });

  it('体积口径 = 帧数 × (像素数 + 色表 + 块开销)，可手算复核', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 30,
      duration: 1,
      width: 240,
      fps: 10,
    });
    // 步长 3 → 30 源帧 ÷ 3 = 10 帧；尺寸 240×135
    expect(plan.frameCount).toBe(10);
    expect(plan.rawBytes).toBe(10 * (240 * 135 + 768 + 24));
  });

  it('不传 range 时覆盖整段（frameRange = 全部帧，左闭右开）', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 30,
      duration: 2,
      width: 240,
      fps: 10,
    });
    expect(plan.frameRange).toEqual({ from: 0, to: 60 });
  });
});

describe('planGif 的导出区间', () => {
  const landscape = { w: 1920, h: 1080 };

  it('区间端点对齐到帧网格（秒 → 帧号只在这里换算一次）', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 30,
      duration: 10,
      range: { start: 0.25, end: 0.5 },
      width: 480,
      fps: 12.5,
    });
    // 0.25 × 30 = 7.5 → round → 8；0.5 × 30 = 15（右开，帧 8..14）
    expect(plan.frameRange).toEqual({ from: 8, to: 15 });
    expect(plan.frameStep).toBe(2);
    expect(plan.frameCount).toBe(4); // ceil(7 / 2)
  });

  it('区间被夹进 [0, duration] —— 输入框里的值可以是任何数', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 30,
      duration: 2,
      range: { start: -5, end: 99 },
      width: 240,
      fps: 10,
    });
    expect(plan.frameRange).toEqual({ from: 0, to: 60 });
  });

  it('end 小于 start 时留下最后一帧，而不是 0 帧', () => {
    // 0 帧会让 GifSink 写出只有 trailer 的 1 字节文件 —— 那是次"成功"的空下载。
    const plan = planGif({
      srcSize: landscape,
      srcFps: 30,
      duration: 2,
      range: { start: 1.5, end: 0.5 },
      width: 240,
      fps: 10,
    });
    expect(plan.frameRange.to).toBe(plan.frameRange.from + 1);
    expect(plan.frameCount).toBeGreaterThanOrEqual(1);
    expect(plan.delaysMs).toHaveLength(plan.frameCount);
  });

  it('区间时长精确：延迟累加 = 区间时长（起点的厘秒取整没有引入偏移）', () => {
    const plan = planGif({
      srcSize: landscape,
      srcFps: 60,
      duration: 24,
      range: { start: 3, end: 8 },
      width: 480,
      fps: 12.5,
    });
    const seconds = plan.delaysMs.reduce((a, b) => a + b, 0) / 1000;
    expect(seconds).toBeCloseTo(5, 3);
    // 体积口径只跟区间内的帧数有关 —— 这正是"只导几秒"能救 GIF 体积的原因。
    expect(plan.rawBytes).toBe(plan.frameCount * (480 * 270 + 768 + 24));
  });
});
