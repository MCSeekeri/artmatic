import { describe, expect, it } from 'vitest';
import {
  clipboardAssetName,
  clipboardAssets,
  fallbackAssetName,
  type ClipboardItemLike,
} from '../../src/ui/clipboard-assets';

/**
 * 剪贴板素材提取的守卫。
 *
 * 三条判据：只认 `kind === 'file'` 的条目（粘贴文字不该变成「不支持的文件」）、
 * 类型靠 MIME 也靠扩展名（截图没有名字）、空名兜底要拼出**真实 MIME** 的扩展名。
 */

function item(kind: string, type: string, file: File | null): ClipboardItemLike {
  return { kind, type, getAsFile: () => file };
}

function fakeFile(name: string, type: string): File {
  // 只要 name / type 两个可读字段；用 Blob 包一层把它变成真的 File。
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('clipboardAssets：挑出素材', () => {
  it('图片 / 视频 / 音频条目都认', () => {
    const out = clipboardAssets([
      item('file', 'image/png', fakeFile('shot.png', 'image/png')),
      item('file', 'video/mp4', fakeFile('take.mp4', 'video/mp4')),
      item('file', 'audio/wav', fakeFile('hit.wav', 'audio/wav')),
    ]);
    expect(out.map((a) => a.kind)).toEqual(['image', 'video', 'audio']);
  });

  it('文本条目被跳过（粘贴一段文字不该弹「不支持的文件」）', () => {
    const out = clipboardAssets([
      item('string', 'text/plain', null),
      item('string', 'text/html', null),
      item('file', 'image/png', fakeFile('shot.png', 'image/png')),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('image');
  });

  it('认不出的文件类型被跳过', () => {
    const out = clipboardAssets([item('file', 'application/pdf', fakeFile('a.pdf', 'application/pdf'))]);
    expect(out).toEqual([]);
  });

  it('getAsFile 返回 null 的条目不产生崩溃', () => {
    const out = clipboardAssets([item('file', 'image/png', null)]);
    expect(out).toEqual([]);
  });

  it('只有扩展名、没有 MIME 的文件也认（部分来源就是这样）', () => {
    const out = clipboardAssets([item('file', '', fakeFile('shot.png', ''))]);
    expect(out.map((a) => a.kind)).toEqual(['image']);
  });
});

describe('fallbackAssetName：空名兜底', () => {
  it('从 MIME 子类型取扩展名', () => {
    expect(fallbackAssetName('剪贴板图片', 'image', 'image/png')).toBe('剪贴板图片.png');
    expect(fallbackAssetName('剪贴板图片', 'image', 'image/webp')).toBe('剪贴板图片.webp');
  });

  it('少数 MIME 子类型要映射成常见扩展名（jpeg → jpg）', () => {
    expect(fallbackAssetName('剪贴板图片', 'image', 'image/jpeg')).toBe('剪贴板图片.jpg');
    expect(fallbackAssetName('剪贴板图片', 'image', 'image/svg+xml')).toBe('剪贴板图片.svg');
    expect(fallbackAssetName('剪贴板视频', 'video', 'video/quicktime')).toBe('剪贴板视频.mov');
  });

  it('带参数的 MIME 只取子类型（audio/wav;codecs=1 → wav）', () => {
    expect(fallbackAssetName('剪贴板音频', 'audio', 'audio/wav;codecs=1')).toBe('剪贴板音频.wav');
  });

  it('认不出的子类型退回该类型的默认扩展名', () => {
    expect(fallbackAssetName('剪贴板音频', 'audio', 'audio/x-unknown')).toBe('剪贴板音频.wav');
    expect(fallbackAssetName('剪贴板图片', 'image', '')).toBe('剪贴板图片.png');
  });
});

describe('clipboardAssetName：有名用名、无名兜底', () => {
  it('文件自带名字时原样用', () => {
    expect(clipboardAssetName({ file: fakeFile('take1.mp4', 'video/mp4'), kind: 'video' })).toBe(
      'take1.mp4',
    );
  });

  it('空名字走兜底（文案来自语言表）', () => {
    expect(clipboardAssetName({ file: fakeFile('', 'image/png'), kind: 'image' })).toBe(
      '剪贴板图片.png',
    );
  });

  it('纯空白名字也算没名字', () => {
    expect(clipboardAssetName({ file: fakeFile('   ', 'audio/wav'), kind: 'audio' })).toBe(
      '剪贴板音频.wav',
    );
  });
});
