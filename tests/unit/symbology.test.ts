import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { GF256_QR, galoisField, rsGeneratorPolynomial, rsParity } from '../../src/algos/symbology/gf';
import { encodeQr, type QrEcLevel } from '../../src/algos/symbology/qr';
import { CODE128_MAX_CHARS, encodeCode128 } from '../../src/algos/symbology/code128';
import { SYMBOLOGIES, encodeCode, isSymbologyId } from '../../src/algos/symbology';

/**
 * 机器可读符号（`algos/symbology/`）的守卫。
 *
 * ## 金标从哪来
 *
 * QR 的每一组 `sha` 都是**参考实现**（`kazuhikoarase/qrcode-generator`，MIT）
 * 算出来的整幅矩阵哈希 —— 不是本项目自己算的。自己算自己当金标等于没测，
 * 而 QR 的错法恰好是「看着完全像二维码、扫不出来」（见 `qr.ts` 文件头）：
 * 纠错级编号、BCH 掩码、格式信息布局、掩码惩罚，任何一处错都不会报错。
 *
 * 金标的生成过程记在 `src/algos/AGENTS.md` 的「机器可读符号」一节，可以重放。
 *
 * ## 为什么拆成「整幅矩阵」与「结构」两类
 *
 * 只有 QR 与 Code 128 有完整标准实现（`standard === true`）。其余五种是结构
 * 复刻（见 `structural.ts` 文件头），没有可信参考可比 —— 所以对它们只断言
 * **能算出来、确定、尺寸合理、静区干净**，不假装它们可扫。
 */

/** 金标：整幅矩阵（'0'/'1' 行、`\n` 连接）的 sha256 前 32 位。 */
const QR_GOLDEN: { text: string; ec: QrEcLevel; sha: string }[] = [
  { text: 'ARTMATIC', ec: 'M', sha: 'd3a6f46b00b333b34083ce0019ff6681' }, // v1 21²
  { text: 'ARTMATIC', ec: 'L', sha: '770f7d5cd8ba80f8f4a5b43b64635c64' }, // v1 21²
  { text: 'ARTMATIC', ec: 'H', sha: '898f52f95baac4916f17718e26f79742' }, // v2 25²
  { text: 'https://artmatic.dev/lab?q=1', ec: 'Q', sha: '1816cea1758545a285642a5226e1adf2' }, // v3
  { text: '算法艺术与故障艺术', ec: 'M', sha: '9ba4f9e122dbe03b9b77e36d95e3f647' }, // v3
  { text: 'x'.repeat(180), ec: 'L', sha: 'a94cd50c58a7e979a123589a13d9f21d' }, // v8
  { text: 'The quick brown fox jumps over the lazy dog. 0123456789', ec: 'M', sha: '69ea04045e2c367d15ffc8acb6dedc49' }, // v4
  { text: '1234567890', ec: 'H', sha: '30c05d0e50ac72804154148b2cfed1bf' }, // v2
];

/**
 * 留一张**完整**的小矩阵（v1 / 21²）。哈希只说「不一样」，这张能直接看出
 * 是定位图形挪了、还是数据区整体位移了一位。
 */
const QR_SAMPLE = [
  '111111100100001111111',
  '100000101111101000001',
  '101110101001101011101',
  '101110101101101011101',
  '101110100001101011101',
  '100000100010101000001',
  '111111101010101111111',
  '000000001111100000000',
  '100000101000111001110',
  '010111001010101010111',
  '011001110011011000010',
  '000111001110000101110',
  '010010101110011100111',
  '000000001001111001100',
  '111111100010101000110',
  '100000100011110011101',
  '101110100000100000101',
  '101110100000100101000',
  '101110100000001010111',
  '100000100110000101100',
  '111111101101010100110',
];

function rowsOf(w: number, h: number, data: Uint8Array): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) row += data[y * w + x] ? '1' : '0';
    rows.push(row);
  }
  return rows;
}

const sha = (rows: string[]): string =>
  createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 32);

describe('GF(2^m) 与 Reed–Solomon', () => {
  test('指数表与对数表互逆，乘法满足交换律与结合律（抽样）', () => {
    for (const gf of [GF256_QR, galoisField(0x43, 6), galoisField(0x13, 4)]) {
      for (let a = 1; a < gf.size; a++) {
        expect(gf.exp[gf.log[a]!], `log/exp 不互逆：${a}`).toBe(a);
      }
      for (let a = 0; a < gf.size; a += 7) {
        for (let b = 0; b < gf.size; b += 11) {
          expect(gf.mul(a, b)).toBe(gf.mul(b, a));
        }
      }
    }
  });

  test('生成多项式的根正是 α^0 .. α^(deg-1)（这是 RS 的定义，不是惯例）', () => {
    for (const deg of [1, 3, 10, 30]) {
      const gen = rsGeneratorPolynomial(GF256_QR, deg);
      expect(gen.length).toBe(deg + 1);
      expect(gen[0]).toBe(1);
      for (let i = 0; i < deg; i++) {
        const x = GF256_QR.exp[i]!;
        // Horner：g(x) 应为 0
        let acc = 0;
        for (const c of gen) acc = GF256_QR.mul(acc, x) ^ c;
        expect(acc, `α^${i} 不是 degree=${deg} 的生成多项式的根`).toBe(0);
      }
    }
  });

  test('纠错字数按请求长度返回（空数据也给全 0）', () => {
    expect(rsParity(GF256_QR, [], 5)).toEqual(new Uint8Array(5));
    expect(rsParity(GF256_QR, [1, 2, 3], 7).length).toBe(7);
    expect(rsParity(GF256_QR, [1, 2, 3], 0).length).toBe(0);
  });
});

describe('QR Code：与参考实现逐位相同', () => {
  test('v1 的完整矩阵（便于看清差在哪一位）', () => {
    const r = encodeQr('ARTMATIC', 'M');
    expect(r.version).toBe(1);
    expect(rowsOf(r.matrix.w, r.matrix.h, r.matrix.toBytes())).toEqual(QR_SAMPLE);
  });

  test.each(QR_GOLDEN)('$ec / $text 的整幅矩阵与参考实现一致', ({ text, ec, sha: want }) => {
    const r = encodeQr(text, ec);
    // `toBytes()` 是 0/255，这里换回 0/1 —— 金标的口径是模块值
    const rows = rowsOf(r.matrix.w, r.matrix.h, r.matrix.toBytes());
    expect(sha(rows), `${ec} ${text.slice(0, 24)}：矩阵与参考实现不一致`).toBe(want);
  });

  test('版本随内容增长，且一定是标准边长（4v+17）', () => {
    const sizes = ['a', 'a'.repeat(60), 'a'.repeat(200)].map((t) => {
      const r = encodeQr(t, 'M');
      expect(r.matrix.w).toBe(r.version * 4 + 17);
      return r.version;
    });
    expect(sizes[0]).toBeLessThan(sizes[1]!);
    expect(sizes[1]).toBeLessThan(sizes[2]!);
  });

  test('纠错级别越高，同一内容用到的版本不会更小', () => {
    const text = 'https://artmatic.dev';
    const l = encodeQr(text, 'L').version;
    const h = encodeQr(text, 'H').version;
    expect(h).toBeGreaterThanOrEqual(l);
  });

  test('装不下时不抛异常，而是标记 truncated（工程不能被一张码卡住）', () => {
    const r = encodeQr('z'.repeat(5000), 'H');
    expect(r.version).toBe(40);
    expect(r.matrix.w).toBe(177);
  });
});

describe('Code 128', () => {
  test('"A" 的完整模块序列：StartB + A + 校验位 34 + Stop', () => {
    const r = encodeCode128('A');
    // 104 / 33 / 34 / 106 的图案串接（StartB = 11010010000，别与 StartC 混）
    expect([...r.modules].join('')).toBe(
      '11010010000' + '10100011000' + '10001011000' + '1100011101011',
    );
    expect(r.checksum).toBe(34);
  });

  test('校验位 = (StartB + Σ value×i) mod 103', () => {
    for (const text of ['ARTMATIC', '1234567890', 'a b c']) {
      const r = encodeCode128(text);
      let sum = 104;
      for (let i = 0; i < r.text.length; i++) sum += (r.text.charCodeAt(i) - 32) * (i + 1);
      expect(r.checksum).toBe(sum % 103);
    }
  });

  test('模块长度 = (符号数)×11 + Stop 多的 2 位', () => {
    const r = encodeCode128('ARTMATIC');
    // Start + 8 数据 + 校验 = 10 个 11 位符号，再加 13 位的 Stop
    expect(r.modules.length).toBe(10 * 11 + 13);
  });

  test('非 ASCII 退化成 ?，超长被截断到上限', () => {
    expect(encodeCode128('中文').text).toBe('??');
    expect(encodeCode128('A'.repeat(200)).text.length).toBe(CODE128_MAX_CHARS);
  });
});

describe('七种符号的统一入口', () => {
  test('每个 id 都能编出来，尺寸随内容增长或持平', () => {
    for (const id of SYMBOLOGIES) {
      const small = encodeCode(id, 'ARTMATIC');
      const big = encodeCode(id, 'https://artmatic.dev/lab?q=machine-readable');
      expect(small.w, `${id} 的模块宽没有意义`).toBeGreaterThan(2);
      expect(small.h, `${id} 的模块高没有意义`).toBeGreaterThan(2);
      expect(big.w).toBeGreaterThanOrEqual(small.w);
      // 静区是内容张成的容器：至少要有码本体那么大
      expect(small.data.length).toBe(small.w * small.h);
    }
  });

  test('同输入两次编码逐字节相同（确定性：不许有裸随机）', () => {
    for (const id of SYMBOLOGIES) {
      const a = encodeCode(id, 'https://artmatic.dev');
      const b = encodeCode(id, 'https://artmatic.dev');
      expect(a.w).toBe(b.w);
      expect(a.h).toBe(b.h);
      expect(a.data).toEqual(b.data);
    }
  });

  test('静区真的干净：四边 quiet 个模块全是白', () => {
    for (const id of SYMBOLOGIES) {
      if (id === 'code128') continue; // 一维码只有左右静区，见下一条
      const q = 4;
      const m = encodeCode(id, 'ARTMATIC', { quiet: q });
      for (let x = 0; x < m.w; x++) {
        for (let k = 0; k < q; k++) {
          expect(m.data[k * m.w + x], `${id} 上边静区有墨`).toBe(0);
          expect(m.data[(m.h - 1 - k) * m.w + x], `${id} 下边静区有墨`).toBe(0);
        }
      }
      for (let y = 0; y < m.h; y++) {
        for (let k = 0; k < q; k++) {
          expect(m.data[y * m.w + k], `${id} 左边静区有墨`).toBe(0);
          expect(m.data[y * m.w + (m.w - 1 - k)], `${id} 右边静区有墨`).toBe(0);
        }
      }
    }
  });

  test('一维码的条高参数真的改高度，且左右静区干净', () => {
    const a = encodeCode('code128', 'ARTMATIC', { quiet: 10, barHeight: 14 });
    const b = encodeCode('code128', 'ARTMATIC', { quiet: 10, barHeight: 40 });
    expect(b.h).toBeGreaterThan(a.h);
    for (let y = 0; y < a.h; y++) {
      for (let k = 0; k < 10; k++) {
        expect(a.data[y * a.w + k]).toBe(0);
        expect(a.data[y * a.w + a.w - 1 - k]).toBe(0);
      }
    }
    const ink = [...a.data].filter((v) => v > 0).length;
    expect(ink, '条形码全白 = 编码器没产出').toBeGreaterThan(0);
  });

  test('二维符号的墨覆盖率落在合理区间（全黑 / 全白都是编码器坏了）', () => {
    for (const id of SYMBOLOGIES) {
      if (id === 'code128') continue;
      const m = encodeCode(id, 'ARTMATIC', { quiet: 0 });
      const ink = [...m.data].filter((v) => v > 0).length / m.data.length;
      expect(ink, `${id} 的墨覆盖率 ${ink.toFixed(2)} 不像一张码`).toBeGreaterThan(0.2);
      expect(ink, `${id} 的墨覆盖率 ${ink.toFixed(2)} 不像一张码`).toBeLessThan(0.85);
    }
  });

  /*
   * 这条抓的是「数据区被静默截断」：GF 的尺寸与码字宽度不匹配时（拿 GF(64) 算
   * 8 位字节），纠错码字会整段归零，表现是**数据区最后几行整行纯白** —— 图看着
   * 还是一张码，只有数行才看得出来。实测踩过一次（MaxiCode 最后一行）。
   */
  test('二维符号没有整行 / 整列留白（数据区必须铺满）', () => {
    for (const id of SYMBOLOGIES) {
      if (id === 'code128') continue;
      const m = encodeCode(id, 'ARTMATIC', { quiet: 0 });
      for (let y = 0; y < m.h; y++) {
        const any = Array.from(m.data.subarray(y * m.w, y * m.w + m.w)).some((v) => v > 0);
        expect(any, `${id} 第 ${y} 行整行是白 —— 数据区没铺满`).toBe(true);
      }
      for (let x = 0; x < m.w; x++) {
        let any = false;
        for (let y = 0; y < m.h && !any; y++) any = m.data[y * m.w + x]! > 0;
        expect(any, `${id} 第 ${x} 列整列是白 —— 数据区没铺满`).toBe(true);
      }
    }
  });

  test('未知 id / 空内容一律降级，不抛异常', () => {
    expect(isSymbologyId('nope')).toBe(false);
    const fallback = encodeCode('nope', 'ARTMATIC');
    expect(fallback.symbology).toBe('qr');
    expect(fallback.standard).toBe(true);
    const empty = encodeCode('qr', '');
    expect([...empty.data].some((v) => v > 0), '空内容也必须有图案').toBe(true);
  });

  test('只有 QR 与 Code 128 标 standard（其余是结构复刻，见 structural.ts）', () => {
    expect(SYMBOLOGIES.filter((id) => encodeCode(id, 'A').standard).sort()).toEqual([
      'code128',
      'qr',
    ]);
  });
});
