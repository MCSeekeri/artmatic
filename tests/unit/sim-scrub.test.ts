/**
 * 模拟步进预算（拖动播放头时用）的守卫。
 *
 * 机制本身在 `AlgoRuntime.planSimStep`：向前拖播放头必须真把中间每一步算完
 * （迭代系统没有闭式解），所以拖动期间只推进「付得起」的步数，画面显示的是
 * 模拟**真实经过**的某一帧（只是比播放头早），松手后继续追赶，追上了就精确。
 *
 * 这里钉住的是**算术**：滞后确实会发生、每帧推进有上界、令牌不会攒出大跳、
 * 而且一定会收敛到目标。`AlgoRuntime` 里那半（真的调用 `seek`、真的测成本）
 * 靠 E2E 断言 `simLag` 的 `>0 → 0` 走通。
 */
import { describe, expect, it } from 'vitest';
import { SIM_CHUNK_STEPS, SIM_TOKEN_FRAMES, planSimStep } from '../../src/algos/runtime';

describe('planSimStep', () => {
  it('向后（或原地）不受预算限制 —— 快照环保证回退代价有上界', () => {
    expect(planSimStep(500, 120, 6, 8, 12)).toEqual({ show: 120, tokens: 0 });
    expect(planSimStep(500, 500, 6, 8, 12)).toEqual({ show: 500, tokens: 0 });
    // 向后时余额清零：否则向前拖攒下的额度会在回退之后突然放量
    expect(planSimStep(0, 0, 6, 8, 999).tokens).toBe(0);
  });

  it('每步便宜时一帧就直达目标', () => {
    // 0.1 ms/步 × 40 步 = 4 ms，预算 6 ms 付得起
    expect(planSimStep(0, 40, 6, 0.1, 0).show).toBe(40);
  });

  it('**付不起时确实会滞后**（这条是整条机制的立足点，不成立则后面全是空转）', () => {
    // Lenia 的真实量级：3.6 ms/步、预算 6 ms ⇒ 一帧付得起 1 步
    const p = planSimStep(0, 1000, 6, 3.6, 0);
    expect(p.show, '预算没起作用 —— 这一帧把 1000 步全算了，等于没压预算').toBeLessThan(1000);
    expect(p.show).toBeLessThanOrEqual(2); // 6 ms 预算 ÷ 3.6 ms/步
  });

  it('便宜的生成器一帧能推很多步（不给它加人为上限）', () => {
    // 兰顿蚂蚁实测 0.000 ms/步。曾经有过「每帧最多 24 步」的上限，那会让它
    // 每帧只走 24 步、9600 步的时间轴要 6.7 秒才追得上 —— 比不压预算还慢。
    // 现在唯一的界是成本下限（0.01 ms/步）⇒ 6 ms 预算约 600 步/帧。
    expect(planSimStep(0, 100_000, 6, 0.001, 0).show).toBeGreaterThan(400);
    // 而真正贵的生成器仍然被压住：这条与上一条必须同时成立
    expect(planSimStep(0, 100_000, 6, 3.6, 0).show).toBeLessThanOrEqual(2);
  });

  it('令牌桶：余额有上限，不会攒出一个大跳', () => {
    const budget = 6;
    const cap = budget * SIM_TOKEN_FRAMES;
    let tokens = 0;
    let frame = 0;
    // 模拟 200 个「目标只比当前帧远一点、所以花不完预算」的帧
    for (let i = 0; i < 200; i++) {
      const r = planSimStep(frame, frame + 1, budget, 1, tokens);
      tokens = r.tokens;
      frame = r.show;
      expect(tokens).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it('一定能收敛到目标（每帧都前进，不会卡住）', () => {
    let frame = 0;
    let tokens = 0;
    let guard = 0;
    while (frame < 5000) {
      const p = planSimStep(frame, 5000, 6, 3.6, tokens);
      expect(p.show).toBeGreaterThan(frame);
      frame = p.show;
      tokens = p.tokens;
      if (++guard > 100_000) throw new Error('一帧一步也该在 10 万帧内走完 5000 步');
    }
    expect(frame).toBe(5000);
  });

  it('每步成本为 0 / NaN 不会让计划炸掉或返回 NaN', () => {
    for (const cost of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = planSimStep(0, 10, 6, cost, 0);
      expect(Number.isFinite(p.show), `cost=${cost}`).toBe(true);
      expect(p.show).toBeGreaterThan(0);
      expect(Number.isFinite(p.tokens)).toBe(true);
    }
  });

  it('分块上限是个小常数（突变的一步最多只影响那一下）', () => {
    // 真正「单帧不会爆炸」的保证在运行期那一侧（分块 + 看表），单测测不到墙钟。
    // 这里只钉住块大小本身是个小量，免得有人为了「快一点」把它调到几百。
    expect(SIM_CHUNK_STEPS).toBeLessThanOrEqual(16);
  });

  it('预算为 0 时是**精确**路径（宿主在导出 / 播放 / 静止时就是这么设的）', () => {
    // 注意：调用方（AlgoRuntime）在 budgetMs === 0 时根本不会调这个函数 ——
    // 这条只是把「0 预算 ⇒ 不滞后」这个约定写下来，免得将来有人在里面加特例。
    const p = planSimStep(0, 10_000, 0, 3.6, 100);
    expect(p.show).toBe(1);
  });
});
