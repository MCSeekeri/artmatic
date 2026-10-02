import { describe, expect, it } from 'vitest';
import {
  assetPathSegments,
  assetRelPath,
  audioAnalysisSegments,
  baseName,
  PROJECT_DIRS,
  safeAssetId,
  safeExt,
  splitRelPath,
  thumbSegments,
} from '../../src/project/layout';

describe('safeExt', () => {
  it('取常规扩展名并小写', () => {
    expect(safeExt('photo.png')).toBe('.png');
    expect(safeExt('PHOTO.PNG')).toBe('.png');
    expect(safeExt('clip.MP4')).toBe('.mp4');
  });

  it('多重扩展名只取最后一段', () => {
    expect(safeExt('archive.tar.gz')).toBe('.gz');
  });

  it('没有扩展名时返回空串', () => {
    expect(safeExt('README')).toBe('');
    expect(safeExt('no-dot')).toBe('');
  });

  it('点开头的名字不算扩展名', () => {
    expect(safeExt('.gitignore')).toBe('');
  });

  it('末尾是点也返回空串', () => {
    expect(safeExt('name.')).toBe('');
  });

  it('丢掉路径部分（目录穿越进不来）', () => {
    expect(safeExt('../../etc/passwd')).toBe('');
    expect(safeExt('/tmp/evil.png')).toBe('.png');
    expect(safeExt('C:\\Users\\a\\b.jpg')).toBe('.jpg');
  });

  it('拒绝带空格或超长的扩展名', () => {
    expect(safeExt('a.p ng')).toBe('');
    expect(safeExt('a.verylongext')).toBe('');
    expect(safeExt('a.p-ng')).toBe('');
  });
});

describe('baseName', () => {
  it('剥掉两种分隔符的路径', () => {
    expect(baseName('a/b/c.png')).toBe('c.png');
    expect(baseName('C:\\a\\b.png')).toBe('b.png');
    expect(baseName('plain.mp3')).toBe('plain.mp3');
  });
});

describe('safeAssetId', () => {
  it('uuid 形式的 id 原样通过', () => {
    expect(safeAssetId('9f1c2ab3-4d5e-6f70-8192-a3b4c5d6e7f8')).toBe('9f1c2ab3-4d5e-6f70-8192-a3b4c5d6e7f8');
  });

  it('滤掉一切可能进文件名的怪字符', () => {
    expect(safeAssetId('a/b')).toBe('ab');
    expect(safeAssetId('a:b*c?')).toBe('abc');
    expect(safeAssetId('a\\b')).toBe('ab');
  });

  it('全滤空时给兜底名', () => {
    expect(safeAssetId('中文')).toBe('asset');
    expect(safeAssetId('')).toBe('asset');
    expect(safeAssetId('***', 'x')).toBe('x');
  });

  it('限长，避免超出文件系统单段上限', () => {
    expect(safeAssetId('a'.repeat(300)).length).toBeLessThanOrEqual(96);
  });
});

describe('路径推导', () => {
  it('素材落在 assets/ 下，名字是 id + 原始扩展名', () => {
    expect(assetPathSegments('id1', 'cover.PNG')).toEqual(['assets', 'id1.png']);
    expect(assetRelPath('id1', 'cover.png')).toBe('assets/id1.png');
  });

  it('素材没有扩展名时也能推', () => {
    expect(assetRelPath('id1', 'LICENSE')).toBe('assets/id1');
  });

  it('音频分析缓存在 analysis/audio 下', () => {
    expect(audioAnalysisSegments('song')).toEqual(['analysis', 'audio', 'song.json']);
  });

  it('缩略图在 thumbs/ 下', () => {
    expect(thumbSegments('clip-a')).toEqual(['thumbs', 'clip-a.png']);
  });

  it('要建的目录里包含 assets / analysis/audio / thumbs', () => {
    const flat = PROJECT_DIRS.map((d) => d.join('/'));
    expect(flat).toContain('assets');
    expect(flat).toContain('analysis/audio');
    expect(flat).toContain('thumbs');
  });
});

describe('splitRelPath', () => {
  it('按斜杠拆开', () => {
    expect(splitRelPath('assets/a.png')).toEqual(['assets', 'a.png']);
  });

  it('丢掉空段与当前目录段', () => {
    expect(splitRelPath('/a//b/./c')).toEqual(['a', 'b', 'c']);
  });

  it('不接受上跳（.. 被丢掉）', () => {
    expect(splitRelPath('../../secret')).toEqual(['secret']);
    expect(splitRelPath('assets/../../x')).toEqual(['assets', 'x']);
  });

  it('空输入给空数组', () => {
    expect(splitRelPath('')).toEqual([]);
    expect(splitRelPath(null as unknown as string)).toEqual([]);
  });
});
