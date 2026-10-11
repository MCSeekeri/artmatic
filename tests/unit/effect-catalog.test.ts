import { describe, expect, it } from 'vitest';
import { EFFECT_CATALOG, EFFECT_CATEGORIES, EFFECT_TAGS, effectTags, structuralTags } from '../../src/effects/catalog';
import { getEffect, listBuiltinEffects } from '../../src/effects/registry';
import { THUMB_BASES, isThumbGeneratorId, thumbGeneratorId } from '../../src/effects/thumbnails/bases';
import { LOCALES } from '../../src/i18n/locales';

/**
 * 目录表（`effects/catalog.ts`）的守卫。
 *
 * 目录是**第三个**每新增特效都要碰的地方（def + glsl + 这里），所以摩擦必须
 * 变成一声明确的报错，而不是「缩略图缺一张、筛选里少一个」这种要肉眼才发现的事。
 *
 * 刻意**不写**的一条：断言 `descKey` 在文案表里存在。`descKey` 的类型是
 * `MessageKey`（= 全部合法键的联合），拼错在 `svelte-check` 就报了 ——
 * 再写一条永远绿的断言，只会让人以为这里有防线。
 *
 * 遍历用 `listBuiltinEffects()` 而**不是** `listEffects()`：目录表是构建期
 * 随内置特效一起发出去的，插件特效自带元数据（`entry.meta`），本来就不该出现在
 * 这张表里。用全量清单的话，运行期挂一个插件就会让这条守卫误报。
 */

const EFFECTS = listBuiltinEffects().map((e) => e.id);

describe('特效目录：覆盖完整', () => {
  it('注册表非空（守卫本身要有覆盖面）', () => {
    expect(EFFECTS.length).toBeGreaterThan(50);
  });

  it('每个注册的特效都有目录条目', () => {
    const missing = EFFECTS.filter((id) => !EFFECT_CATALOG[id]);
    expect(
      missing,
      '这些特效没有缩略图底图 / 说明 / 分类 → 在选择器里会缺图或漏筛',
    ).toEqual([]);
  });

  it('目录里没有孤儿（每个条目都对应真实特效）', () => {
    const known = new Set(EFFECTS);
    const orphans = Object.keys(EFFECT_CATALOG).filter((id) => !known.has(id));
    expect(orphans, '目录里有已被删除/改名的特效').toEqual([]);
  });

  it('分类是六选一，且每个分类都真的有特效', () => {
    for (const [id, entry] of Object.entries(EFFECT_CATALOG)) {
      expect(EFFECT_CATEGORIES, `${id} 的分类非法`).toContain(entry.category);
    }
    const used = new Set(Object.values(EFFECT_CATALOG).map((e) => e.category));
    expect([...used].sort()).toEqual([...EFFECT_CATEGORIES].sort());
  });

  /*
   * 分类名与标签名的文案。
   *
   * 这两处**绕过了类型检查**：选择器要按 `fx.cat.${category}` 现拼键名，
   * 拼不出字面量类型，只能 `as MessageKey`。所以补一条运行期断言 ——
   * 少了它，拼错一个分类名会在界面上显示成 key 本身（`fx.cat.color`），
   * 而这种问题只有肉眼扫过那一行才会发现。
   */
  it('每个分类与标签都有文案（这两处的键名是拼出来的，TS 覆盖不到）', () => {
    const locale = LOCALES['zh-CN'] as Record<string, string>;
    for (const c of EFFECT_CATEGORIES) {
      expect(locale[`fx.cat.${c}`], `缺文案 fx.cat.${c}`).toBeTruthy();
    }
    for (const t of EFFECT_TAGS) {
      expect(locale[`fx.tag.${t}`], `缺文案 fx.tag.${t}`).toBeTruthy();
    }
  });
});

describe('缩略图底图', () => {
  it('每条目录的底图都是已定义的底图', () => {
    const ids = new Set(THUMB_BASES.map((b) => b.id));
    const bad = Object.entries(EFFECT_CATALOG)
      .filter(([, e]) => !ids.has(e.base))
      .map(([id, e]) => `${id} → ${e.base}`);
    expect(bad).toEqual([]);
  });

  // 每张底图都要有人用 —— 没人用的底图是白写的，而且它占着「择图理由表」一行，
  // 会让下一个人以为那条路径被验证过。加底图就要有特效用它。
  it('每张底图都至少被一个特效用到', () => {
    const used = new Set(Object.values(EFFECT_CATALOG).map((e) => e.base));
    const unused = THUMB_BASES.map((b) => b.id).filter((id) => !used.has(id));
    expect(unused, '这些底图没有任何特效在用').toEqual([]);
  });

  // 需求明确点名的两条择图要求，钉死在测试里：它们最容易在后续调整中被"顺手改掉"，
  // 而改坏的观感是「缩略图看不出变化」，非常容易被当成"这个特效本来就这样"。
  it('去饱和度用高饱和彩条，不用灰阶底图', () => {
    expect(EFFECT_CATALOG['bleach']!.base).toBe('bars');
  });

  it('通道错位用纯黑白底图（彩条上看不出通道分离）', () => {
    expect(EFFECT_CATALOG['channel-split']!.base).toBe('mandel');
    expect(EFFECT_CATALOG['channel-split-prism']!.base).toBe('mandel');
  });

  // 运动类特效在**静止**底图上运动量恒为 0 —— 缩略图会是纯黑。所以它们必须
  // 落在会动的底图上。这条守的是「底图选错 = 缩略图空白」这一类。
  it('按运动量工作的特效落在会动的底图上', () => {
    for (const id of ['motion-mask', 'fast-mosh', 'kino-datamosh', 'optical-flow']) {
      expect(EFFECT_CATALOG[id]!.base, `${id} 在静止底图上什么都看不到`).toBe('scroll');
    }
  });

  it('伪 generator id 有前缀，且能被识别', () => {
    expect(thumbGeneratorId('bars')).toBe('thumb:bars');
    expect(isThumbGeneratorId('thumb:bars')).toBe(true);
    expect(isThumbGeneratorId('bars')).toBe(false);
    // 底图 id 不许和真生成器撞（撞了就会被 resolver 误判成真生成器）
    for (const b of THUMB_BASES) expect(isThumbGeneratorId(b.id)).toBe(false);
  });
});

describe('标签', () => {
  it('结构标签从 shader def 推导，且推得对', () => {
    const fb = getEffect('echo')!;
    expect(fb.shader.feedback).toBe(true);
    expect(structuralTags(fb.shader)).toContain('feedback');

    const multi = getEffect('glow')!;
    expect(multi.shader.prePasses?.length ?? 0).toBeGreaterThan(0);
    expect(structuralTags(multi.shader)).toContain('multipass');

    const hdr = getEffect('petri')!;
    expect(hdr.shader.hdrFeedback).toBe(true);
    expect(structuralTags(hdr.shader)).toContain('hdr');

    const audio = getEffect('audio-bars')!;
    expect(structuralTags(audio.shader)).toContain('audio');

    // 静态特效不该被贴上「随时间动」
    const still = getEffect('bleach')!;
    expect(structuralTags(still.shader)).not.toContain('animated');
  });

  it('自动标签与目录标记合并后顺序稳定，且不含重复', () => {
    for (const id of EFFECTS) {
      const entry = EFFECT_CATALOG[id]!;
      const shader = getEffect(id)!.shader;
      const tags = effectTags(shader, entry);
      expect(new Set(tags).size, `${id} 的标签有重复`).toBe(tags.length);
      // 顺序 = EFFECT_TAGS 的子序列
      let cursor = -1;
      for (const t of tags) {
        const at = EFFECT_TAGS.indexOf(t);
        expect(at, `${id} 的标签 ${t} 不在 EFFECT_TAGS 里`).toBeGreaterThan(cursor);
        cursor = at;
      }
    }
  });

  it('「叠加型」只来自目录标记（结构标签推不出来）', () => {
    const overlay = EFFECTS.filter((id) => effectTags(getEffect(id)!.shader, EFFECT_CATALOG[id]!).includes('overlay'));
    // 有就行（13 个左右），但别多到失去区分度
    expect(overlay.length).toBeGreaterThan(5);
    expect(overlay.length).toBeLessThan(EFFECTS.length / 2);
  });
});
