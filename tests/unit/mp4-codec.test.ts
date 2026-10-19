import { describe, expect, it } from 'vitest';
import { MP4_CODEC, MP4_CODEC_LADDER, pickMp4Codec } from '../../src/exporters/mp4-sink';

/**
 * W0.5 的阶梯选择。
 *
 * `isConfigSupported` 在 Node 里不存在，所以真正能测的是「拿到每一档的
 * 支持情况之后选哪一档」—— 这恰好是最容易写错的部分（跳过、全 false、
 * software 标记）。
 */
describe('MP4 codec 阶梯', () => {
  it('阶梯顺序固定：Main 4.0 → Main 3.1 → Baseline 4.0 → Baseline 3.1', () => {
    expect([...MP4_CODEC_LADDER]).toEqual([
      'avc1.4d0028',
      'avc1.4d401f',
      'avc1.42e028',
      'avc1.42e01e',
    ]);
    // 兼容既有调用点：`MP4_CODEC` 永远是首档。
    expect(MP4_CODEC).toBe(MP4_CODEC_LADDER[0]);
  });

  it('首档支持就用首档（硬件主路径）', () => {
    expect(pickMp4Codec([true, true, true, true])).toEqual({
      codec: 'avc1.4d0028',
      rung: 0,
      software: false,
    });
  });

  it('跳过不支持的档位，并在落到 baseline 时标记软件路径', () => {
    expect(pickMp4Codec([false, true, true, true])).toMatchObject({
      codec: 'avc1.4d401f',
      rung: 1,
      software: false,
    });
    // 1080p 的软件路径：baseline 3.1 的 coded area 不够，必须停在 4.0。
    expect(pickMp4Codec([false, false, true, true])).toMatchObject({
      codec: 'avc1.42e028',
      rung: 2,
      software: true,
    });
    expect(pickMp4Codec([false, false, false, true])).toMatchObject({
      codec: 'avc1.42e01e',
      rung: 3,
      software: true,
    });
  });

  it('四档全不支持才返回 null（调用方退回 PNG）', () => {
    expect(pickMp4Codec([false, false, false, false])).toBeNull();
  });
});
