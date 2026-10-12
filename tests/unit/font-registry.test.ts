import { describe, expect, it } from 'vitest';
import { FontRegistry } from '../../src/typography/font-registry';
import { createTextElement, createTypographyDocument } from '../../src/typography/document';

function docUsing(family: string) {
  const doc = createTypographyDocument();
  const el = createTextElement(doc.size, { text: 'hi' });
  el.style.fontFamily = family;
  doc.elements.push(el);
  return doc;
}

describe('FontRegistry.missing —— 内置字体的在途 / 失败口径', () => {
  it('内置字体尚未 loaded（在途）不报缺失', () => {
    const reg = new FontRegistry();
    reg.registerBuiltin('Inter', '/fonts/inter-latin-400.woff2');
    // 预加载是异步的，这一刻 loaded 仍是 false —— 不能因此报「还没准备好」。
    expect(reg.facesOf('Inter')[0]!.loaded).toBe(false);
    expect(reg.missing(docUsing('Inter'))).toEqual([]);
  });

  it('内置字体真的加载失败才报缺失', () => {
    const reg = new FontRegistry();
    reg.registerBuiltin('Inter', '/fonts/inter-latin-400.woff2');
    reg.facesOf('Inter')[0]!.failed = true;
    expect(reg.missing(docUsing('Inter'))).toEqual(['Inter']);
  });

  it('内置字体 loaded 之后不报缺失', () => {
    const reg = new FontRegistry();
    reg.registerBuiltin('Inter', '/fonts/inter-latin-400.woff2');
    reg.facesOf('Inter')[0]!.loaded = true;
    expect(reg.missing(docUsing('Inter'))).toEqual([]);
  });

  it('用户导入的字体（非内置）未 loaded 仍照报 —— 例外没有放宽', async () => {
    const reg = new FontRegistry();
    await reg.registerFile('x.ttf', new ArrayBuffer(8), 'MyFace');
    expect(reg.missing(docUsing('MyFace'))).toEqual(['MyFace']);
  });
});
