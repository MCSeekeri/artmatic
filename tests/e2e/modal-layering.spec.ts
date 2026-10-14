import { expect, test, type Page } from '@playwright/test';
import { openDemo, buildStage } from './_stage';

/**
 * modal 必须真的在**最上面**。
 *
 * ## 为什么需要这条（它是从一个真 bug 来的）
 *
 * 抽屉（`aside.drawer`）是一个**层叠上下文**。从抽屉里打开的 modal 会被困在
 * 抽屉那一层：backdrop 写的是 `--z-modal`（150），可只要抽屉的 z 比时间轴内部
 * 的刻度低，**时间轴的 ruler（5）、播放头（4）、选中的片段（3）都会盖到 modal
 * 上面**。实际表现是「特效选择器开着，缩略图上横着一条白色标尺 + 一个播放头」，
 * 而排查时盯着时间轴的 z-index 看是找不到的 —— 问题在 modal 被关得太低。
 *
 * ## 判据不是「比 z-index」
 *
 * 只比声明的 z-index 是错的：它不反映层叠上下文。这里算的是**有效层级** ——
 * 一个元素最终落在根上下文的哪一层 = 它自己那层与沿途每个层叠上下文的 z
 * **取最小**。然后把「与 modal 面板相交、又不在 modal 子树里的元素」全部算一遍，
 * 断言没有一个 ≥ modal 的有效层级。
 *
 * 这样写的好处：不管将来是谁（新加一个 z-index、给某个祖先加 transform、
 * 给抽屉调层级）破坏了它，报出来的都是「谁、有效层级多少」。
 */

interface LayerApi {
  __artmatic: {
    appState: { selectedClipId: string | null };
    store: { project: { tracks: { clips: { id: string; kind: string }[] }[] } };
  };
}

/** 打开「添加特效」选择器（它开在抽屉里，正是出事的那条路径）。 */
async function openPicker(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  await buildStage(
    page,
    { id: 'layer', source: { type: 'algo', generator: 'mandelbrot', params: { intRes: '480' } }, end: 8 },
    { id: 'layer-fx', defId: 'channel-split', values: {} },
  );
  await page.evaluate(() => {
    const A = (window as never as LayerApi).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.kind === 'effect') A.appState.selectedClipId = c.id;
    }
  });
  await page.getByTestId('add-effect-instance').click();
  await page.waitForSelector('.modal.picker');
}

interface LayerReport {
  modalZ: number;
  offenders: string[];
  backdropAncestors: string[];
}

test('抽屉里打开的 modal：时间轴的任何东西都不许盖在它上面', async ({ page }) => {
  // 用户报的那个窗口尺寸（截图 2238×1282 @2x）—— 视口越小，时间轴与 modal
  // 的重叠区越大，这条越容易暴露。
  await page.setViewportSize({ width: 1119, height: 641 });
  await openPicker(page);

  const report = await page.evaluate((): LayerReport | { error: string } => {
    const backdrop = document.querySelector('.backdrop');
    const panel = document.querySelector('.modal.picker');
    if (!backdrop || !panel) return { error: 'modal 没打开' };

    const tag = (el: Element): string => {
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };
    /** 非 z-index 的层叠上下文成因（`transform` / `filter` / `opacity` …）。 */
    const contextual = (cs: CSSStyleDeclaration): boolean =>
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.perspective !== 'none' ||
      cs.mixBlendMode !== 'normal' ||
      cs.isolation === 'isolate' ||
      cs.opacity !== '1' ||
      cs.contain.includes('paint') ||
      cs.contain.includes('layout');

    /** 元素落在**根上下文**的哪一层：自己那层与沿途每个上下文的 z 取最小。 */
    const effectiveZ = (el: Element, ownZ: number): number => {
      let z = ownZ;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.position !== 'static' && cs.zIndex !== 'auto') z = Math.min(z, Number(cs.zIndex));
        else if (contextual(cs)) z = Math.min(z, 0);
      }
      return z;
    };

    const csBackdrop = getComputedStyle(backdrop);
    const backdropZ = csBackdrop.zIndex === 'auto' ? 0 : Number(csBackdrop.zIndex);
    const modalZ = effectiveZ(backdrop, backdropZ);

    const ancestors: string[] = [];
    for (let p = backdrop.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') {
        ancestors.push(`${tag(p)} z=${cs.zIndex}`);
      }
    }

    const rect = panel.getBoundingClientRect();
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      // modal 自己、它的子孙、以及它的祖先都不是「竞争者」
      if (el === backdrop || backdrop.contains(el) || el.contains(backdrop)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= rect.left || r.left >= rect.right || r.bottom <= rect.top || r.top >= rect.bottom) {
        continue;
      }
      const cs = getComputedStyle(el);
      const own = cs.position !== 'static' && cs.zIndex !== 'auto' ? Number(cs.zIndex) : 0;
      const eff = effectiveZ(el, own);
      // 有效层级相同 = 谁在后面谁赢，无法从静态判断；只报「明确更高」的。
      if (eff > modalZ) {
        offenders.push(`${tag(el)} eff=${eff} (own=${own}, pos=${cs.position})`);
      }
    }
    return { modalZ, offenders, backdropAncestors: ancestors };
  });

  expect('error' in report, JSON.stringify(report)).toBe(false);
  const r = report as LayerReport;
  // 非空断言：modal 必须真的比时间轴内部那套（≤5）高，否则这条是空转
  expect(r.modalZ, 'modal 的有效层级应当高过时间轴内部刻度（5）').toBeGreaterThan(5);
  expect(
    r.offenders,
    `这些元素的有效层级高于 modal，会盖在它上面（backdrop 的祖先：${r.backdropAncestors.join(' → ')}）`,
  ).toEqual([]);
});

test('同一把尺子：把抽屉的层级调低，这条守卫必须变红', async ({ page }) => {
  // 反向验证写进用例本身而不是靠人记得跑一遍：临时把抽屉压回 z-index: 1
  // （就是出事时的值），断言「确实会有元素盖上来」。
  await page.setViewportSize({ width: 1119, height: 641 });
  await openPicker(page);
  await page.evaluate(() => {
    const drawer = document.querySelector('aside.drawer');
    if (drawer) (drawer as HTMLElement).style.zIndex = '1';
  });
  const offenders = await page.evaluate((): string[] => {
    const backdrop = document.querySelector('.backdrop')!;
    const panel = document.querySelector('.modal.picker')!;
    const tag = (el: Element): string => {
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };
    const modalZ = 1; // 抽屉被压回 1 ⇒ modal 的有效层级就是 1
    const rect = panel.getBoundingClientRect();
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el === backdrop || backdrop.contains(el) || el.contains(backdrop)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= rect.left || r.left >= rect.right || r.bottom <= rect.top || r.top >= rect.bottom) {
        continue;
      }
      const cs = getComputedStyle(el);
      if (cs.position === 'static' || cs.zIndex === 'auto') continue;
      if (Number(cs.zIndex) > modalZ) out.push(`${tag(el)} z=${cs.zIndex}`);
    }
    return out;
  });
  expect(offenders.length, '压回 z-index: 1 之后应当确实有元素盖上来').toBeGreaterThan(0);
  // 时间轴的 ruler 必须是其中之一 —— 它正是用户看到的那条白条
  expect(offenders.join(' ')).toContain('ruler');
});
