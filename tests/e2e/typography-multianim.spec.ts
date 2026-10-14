/**
 * typography-multianim.spec.ts — 自定义 CSS 的「逗号分隔多动画」。
 *
 * 两条断言，缺一不可：
 *  1. **绑定生效**：一个动画条目绑上 `animation: a …, b …` 后，那个动画层上真的
 *     有两条 `animation-name`（逗号分隔）—— 证明多动画被解析并发出。
 *  2. **keyframes 名不互相覆盖**：两个元素各自写 `@keyframes a` 时，它们实际绑定的
 *     名字**必须不同**。这是本特性的核心不变量（同一份样式表里重名会互相覆盖），
 *     而断言「名字不同」不依赖命名方案本身（前缀 / 哈希都行）。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function addTextClip(page: Page): Promise<string> {
  const ids = (): Promise<string[]> =>
    page.evaluate(() => {
      const A = (window as never as { __artmatic: { store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } } } }).__artmatic;
      const out: string[] = [];
      for (const t of A.store.project.tracks) for (const c of t.clips) if (c.source?.type === 'text') out.push(c.id);
      return out;
    });
  const before = await ids();
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const added = (await ids()).filter((id) => !before.includes(id));
  expect(added, '「+ 排版片段」没有新增片段').toHaveLength(1);
  return added[0]!;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

/** 把当前选区绑上「两条动画」的自定义 CSS（两个 keyframes + 逗号分隔简写）。 */
async function applyMultiAnim(page: Page): Promise<void> {
  await page.getByTestId('ribbon-tab-anim').click();
  await page.getByTestId('typo-anim-css').click();
  await expect(page.getByTestId('typo-css-modal')).toBeVisible();
  await page
    .getByTestId('typo-css-input')
    .fill(
      '@keyframes a{from{opacity:0}to{opacity:1}} @keyframes b{from{opacity:1}to{opacity:.4}}\n' +
        'animation: a 1s linear infinite, b 2s linear infinite;',
    );
  await page.getByTestId('typo-css-save').click();
  await expect(page.getByTestId('typo-css-modal')).toHaveCount(0);
}

/** 舞台上所有动画层实际绑定到的 animation-name（去空白）。 */
function boundNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.paper [data-anim-id]')).map((el) =>
      getComputedStyle(el as Element).animationName.trim(),
    ),
  );
}

/** 样式表里真正定义过的 @keyframes 名。 */
function definedKeyframes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | undefined;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // 跨源样式表读不到，跳过
      }
      if (!rules) continue;
      for (const r of Array.from(rules)) {
        if (r.type === 7) out.push((r as CSSKeyframesRule).name);
      }
    }
    return out;
  });
}

test('自定义 CSS 逗号分隔多动画：绑定生效，且同名 keyframes 不互相覆盖', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await page.getByTestId('typo-tab-layers').click();

  // 元素 1：点中它 → 绑多动画
  const el1 = (await page.locator('.paper [data-el-id]').first().boundingBox())!;
  await page.mouse.click(el1.x + el1.width / 2, el1.y + el1.height / 2);
  await expect(page.getByTestId('typo-selection')).toBeVisible();
  await applyMultiAnim(page);

  // 元素 2：插入一个文本框，绑**同一份** CSS（重名的 keyframes a / b）
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-insert-text').click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
  await applyMultiAnim(page);

  const names = await boundNames(page);
  expect(names, '舞台上有两个动画层（每个元素一个自定义动画条目）').toHaveLength(2);

  const bound = names[0]!.split(',').map((s) => s.trim());
  expect(bound, '一个条目要绑上两条动画（逗号分隔）').toHaveLength(2);

  // 两条绑定都必须指向真实定义过的 keyframes（没有悬空引用）。
  const defined = await definedKeyframes(page);
  for (const b of bound) expect(defined, `animation-name "${b}" 必须真的被 @keyframes 定义过`).toContain(b);

  // 核心不变量：两个元素各自写的 keyframes 名互相隔离，不共用同一个名字。
  expect(names[0], '两个元素的绑定名不能相同（同名 keyframes 会互相覆盖）').not.toBe(names[1]);
});
