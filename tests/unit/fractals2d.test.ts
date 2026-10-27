import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEQ,
  MAX_SEQ_LEN,
  LYAPUNOV_FRAG,
  lyapunovDef,
  sequenceBits,
} from '../../src/algos/lyapunov';
import { NEWTON_FRAG, newtonDef } from '../../src/algos/newton';
import { KLEINIAN_FRAG, kleinianDef } from '../../src/algos/kleinian';
import { bitmapFromRows, encodePattern } from '../../src/algos/pattern-codec';
import { listGenerators } from '../../src/algos/registry';
import { ALGO_HEAD, declaredUniforms } from '../../src/algos/shader-lib';

/**
 * 三个 2D 分形的契约与纯函数。
 *
 * 这三个的**几何全在 fragment 里**，所以能纯测的只有两样：序列的编解码
 * （`sequenceBits`）与「这个 def 的接线形状对不对」。前者是这批里唯一会
 * **静默错**的东西 —— 位序反了不报错，只是画出来的图与编辑器里画的那一行
 * 次序相反。后者的价值在于把「加参数漏了一半」变成明确报错。
 */

describe('Lyapunov 的序列编解码', () => {
  const seq = (...rows: string[]): string => encodePattern(bitmapFromRows(rows));

  it('低位 = 序列第 0 位，1 = A', () => {
    // '#.': 第 0 位是 A（bit0 = 1）、第 1 位是 B（bit1 = 0）⇒ 掩码 1
    expect(sequenceBits(seq('#.'))).toEqual({ bits: 0b01, len: 2 });
    // '##..': A,A,B,B ⇒ bit0|bit1 = 3
    expect(sequenceBits(seq('##..'))).toEqual({ bits: 0b0011, len: 4 });
    // '##.#.'（默认）: A,A,B,A,B ⇒ 1 + 2 + 8 = 11
    expect(sequenceBits(seq('##.#.'))).toEqual({ bits: 0b01011, len: 5 });
    // 反向的 '.##.#' 必须给出**不同**的掩码 —— 这条挡「位序写反」
    // '.##.#': B,A,A,B,A ⇒ bit1|bit2|bit4 = 2 + 4 + 16 = 22
    expect(sequenceBits(seq('.##.#'))).toEqual({ bits: 0b10110, len: 5 });
  });

  it('长度来自图案本身，不是最高位', () => {
    // 'A' 与 'AB'：单看最低位都是 1，但长度不同 ⇒ 序列不同。
    // 这正是当初不用 `bitmask` 而用 `pattern` 的理由（bitmask 只有一个整数）。
    expect(sequenceBits(seq('##..')).len).toBe(4);
    expect(sequenceBits(seq('##......')).len).toBe(8);
  });

  it('空串 / 坏串 / 单格回退到「AB」，不抛', () => {
    for (const bad of ['', 'x', '4x1:!!!', null, undefined, 42, {}]) {
      expect(sequenceBits(bad), String(bad)).toEqual({ bits: 0b10, len: 2 });
    }
    // 单格（长度 1）也算坏输入：周期 1 的序列退化成「只有一个 r」，
    // 图会变成一条对角线，不是这个生成器想画的东西
    expect(sequenceBits(seq('#')).len).toBe(2);
  });

  it('一位都没点亮的序列回退到 AB —— 否则 a 区间会完全失去作用', () => {
    // 这不是假想的输入：`decodePattern` 刻意宽容（跳过未知字符），
    // 所以一段垃圾解出来就是一张全 0 的图；而用户手动擦空那一行也一样。
    // 「全是 B」时 a 的上下限拖了没反应，是最难自查的状态，所以直接回退。
    expect(sequenceBits(seq('....'))).toEqual({ bits: 0b10, len: 2 });
    // 对照：只要有一个 A 就照原样用
    expect(sequenceBits(seq('...#'))).toEqual({ bits: 0b1000, len: 4 });
  });

  it('超长图案被截到 MAX_SEQ_LEN（更长就丢整数精度）', () => {
    const long = seq('#'.repeat(40));
    expect(sequenceBits(long).len).toBe(MAX_SEQ_LEN);
  });

  it('24 位掩码在 float32 里逐位精确 —— MAX_SEQ_LEN 的硬约束', () => {
    // shader 用 float 存掩码并靠 `floor(bits / 2^k) mod 2` 取位，
    // 所以「多少位还精确」是**机制性**的约束，不是随便定的一个数
    expect(Math.fround(2 ** 24 - 1)).toBe(2 ** 24 - 1);
    expect(Math.fround(2 ** 25 - 1)).not.toBe(2 ** 25 - 1);
    expect(MAX_SEQ_LEN, '超到 25 位就会静默丢位').toBeLessThanOrEqual(24);
  });

  it('shader 的取位公式与编辑器里画的那一行逐位一致', () => {
    // shader: `mod(floor(u_seqBits / exp2(k)), 2)` —— 这里照抄成 JS 对拍。
    // 两边任何一处改了位序（比如有人把 shader 改成 `exp2(len-1-k)`），
    // 这条就会红；不然表现只是「编辑器里画的和画出来的左右相反」。
    const shaderBit = (bits: number, k: number): number => Math.floor(bits / 2 ** k) % 2;
    for (const row of ['#.', '##..', '##.#.', '.#.#.#', '#'.repeat(MAX_SEQ_LEN)]) {
      const { bits, len } = sequenceBits(encodePattern(bitmapFromRows([row])));
      expect(len, row).toBe(row.length);
      for (let k = 0; k < len; k++) {
        expect(shaderBit(bits, k), `第 ${k} 位 of「${row}」`).toBe(row[k] === '#' ? 1 : 0);
      }
    }
  });

  it('出厂默认值的序列是「AABAB」，不是回退值', () => {
    const p = lyapunovDef.params.find((q) => q.key === 'sequence');
    expect(p?.type).toBe('pattern');
    expect(p?.defaultValue).toBe(encodePattern(bitmapFromRows([DEFAULT_SEQ])));
    // 用回退值（AB）会让这条红 —— 那样默认图与设计意图就不是一回事了
    expect(sequenceBits(p?.defaultValue)).toEqual({ bits: 0b01011, len: 5 });
  });
});

/**
 * 李雅普诺夫指数的**参照实现**（照文件头那条公式重写一遍）。
 *
 * 与 `sim-util.TorusField` 对拍朴素卷积同一个手法：验证「我理解的那条公式」
 * 与「我认为代码在算的东西」一致。这里的价值不是防止 shader 写错（shader 测
 * 不到），而是把**公式本身**钉住 —— logistic 映射的混沌阈值是教科书里的已知数，
 * 算不出那个符号翻转就说明公式（或 warmup 的口径）理解错了。
 */
function lyapunovExponent(seqStr: string, a: number, b: number, iter = 2000, warmup = 1000): number {
  let x = 0.5;
  const rAt = (k: number): number => (seqStr[k % seqStr.length] === 'A' ? a : b);
  for (let i = 0; i < warmup; i++) {
    const r = rAt(i);
    x = r * x * (1 - x);
  }
  let sum = 0;
  for (let i = 0; i < iter; i++) {
    const r = rAt(i);
    x = r * x * (1 - x);
    sum += Math.log(Math.max(Math.abs(r * (1 - 2 * x)), 1e-9));
  }
  return sum / iter;
}

describe('李雅普诺夫指数公式', () => {
  it('单参数序列复现 logistic 映射的已知行为', () => {
    // 不动点区：λ < 0
    expect(lyapunovExponent('A', 2.5, 2.5)).toBeLessThan(0);
    // 周期 2 窗口：λ 仍然 < 0
    expect(lyapunovExponent('A', 3.2, 3.2)).toBeLessThan(0);
    // 混沌区：λ > 0
    expect(lyapunovExponent('A', 4.0, 4.0)).toBeGreaterThan(0);
  });

  it('符号翻转落在 logistic 映射的混沌阈值 3.5699 两侧', () => {
    // 这是教科书里的常数，不是调出来的：翻转位置错了说明公式或 warmup 错了
    expect(lyapunovExponent('A', 3.55, 3.55)).toBeLessThan(0);
    expect(lyapunovExponent('A', 3.6, 3.6)).toBeGreaterThan(0);
  });

  it('a = b 时序列不起作用（对角线上的退化情形）', () => {
    const ab = lyapunovExponent('AB', 3.8, 3.8);
    const aa = lyapunovExponent('AA', 3.8, 3.8);
    expect(Math.abs(ab - aa)).toBeLessThan(1e-9);
  });

  it('a ≠ b 时序列真的改变指数（AB 与 AABB 不同）', () => {
    const ab = lyapunovExponent('AB', 3.9, 3.2);
    const aabb = lyapunovExponent('AABB', 3.9, 3.2);
    expect(Math.abs(ab - aabb), '序列没起作用 —— 换序列的 E2E 就会是空转').toBeGreaterThan(0.01);
  });
});

describe('三个 2D 分形的接线契约', () => {
  const defs = { newton: newtonDef, kleinian: kleinianDef, lyapunov: lyapunovDef };
  const frags = { newton: NEWTON_FRAG, kleinian: KLEINIAN_FRAG, lyapunov: LYAPUNOV_FRAG };

  it('都注册成了 realtime，且都在注册表里', () => {
    const ids = new Set(listGenerators().map((g) => g.id));
    for (const [id, def] of Object.entries(defs)) {
      expect(def.kind, id).toBe('realtime');
      expect(ids.has(id), `${id} 没有注册`).toBe(true);
    }
  });

  it('共用参数尾巴都在（intRes），且没有重名的参数键', () => {
    for (const [id, def] of Object.entries(defs)) {
      const keys = def.params.map((p) => p.key);
      expect(keys, `${id} 缺 intRes`).toContain('intRes');
      expect(new Set(keys).size, `${id} 有重名的参数键`).toBe(keys.length);
    }
  });

  it('fragment 不重声明 ALGO_HEAD 的 uniform（重声明会链接失败）', () => {
    const head = declaredUniforms(ALGO_HEAD);
    for (const [id, frag] of Object.entries(frags)) {
      for (const name of declaredUniforms(frag).keys()) {
        expect(head.has(name), `${id} 重声明了 ALGO_HEAD 的 ${name}`).toBe(false);
      }
    }
  });

  it('fragment 里不出现反引号以外的模板隐患：没有 `#version`（头里已经有一份）', () => {
    for (const [id, frag] of Object.entries(frags)) {
      expect(frag.includes('#version'), `${id} 自己写了 #version`).toBe(false);
    }
  });

  it('Newton 走的是复数除法，不是 GLSL 的逐分量除法', () => {
    // `vec2 / vec2` 在 GLSL 里是逐分量除法 —— 写成 `a / b` 能编译能跑，
    // 结果完全不是牛顿法（画面仍像分形，所以肉眼看不出来）。
    // 这里挡的是「有人把 cdiv 调用删掉换成 /」。
    expect(NEWTON_FRAG).toContain('vec2 cdiv(');
    expect(NEWTON_FRAG).toContain('cdiv(zn - vec2(1.0, 0.0), dz)');
  });

  it('Kleinian 的判据对 u 的适用范围有约束（常数是按 u≈1.94 标定的）', () => {
    const p = kleinianDef.params.find((q) => q.key === 'real');
    expect(p?.type).toBe('range');
    if (p?.type !== 'range') throw new Error('unreachable');
    // 来源里的常数（1.95 / 7.2 / 15）只在 u≈1.94 附近成立；区间放开 = 会出糊图
    expect(p.min).toBeGreaterThanOrEqual(1.7);
    expect(p.max).toBeLessThanOrEqual(2.2);
    expect(p.defaultValue).toBeCloseTo(1.94, 2);
  });
});
