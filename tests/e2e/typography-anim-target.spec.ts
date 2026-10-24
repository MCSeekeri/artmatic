import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * 动画的**作用层**（`ElementAnimation.target`）。
 *
 * 引入这个字段之前，所有动画都挂在 `.typo-el` 的**内层**包装上：`clip-path` 只裁
 * 文字、`rotate` 只转字，文本框底板与边框一动不动。CSS 动画只重绘被选中的节点及其
 * 子树，所以这不是 bug 而是落点选错。
 *
 * 两条用例各守一半：
 *  1. **像素**（走 `typoRasterize`，不经过 compositor）：`target:'box'` 时
 *     `clip-path` 裁到文本框底板；缺省（content）时底板完好 —— 后者同时是
 *     「旧工程逐像素不变」的承诺。
 *  2. **结构与往返**：面板的层开关真的把动画层放到外壳**之外**，外壳退化成
 *     `inset: 0`（几何只有最外层承担，否则 left/top 会被算两遍），且同一属性在
 *     两层各一条时互不顶掉。
 */

const DOC_W = 400;
const DOC_H = 200;

interface Shot {
  w: number;
  h: number;
  ink: number;
  sum: number;
  hash: string;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

async function selectFirst(page: Page): Promise<void> {
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
}

async function firstElementId(page: Page, clipId: string): Promise<string> {
  return page.evaluate(({ id }) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: {
            tracks: {
              clips: { id: string; source?: { type?: string; doc?: { elements: { id: string }[] } } }[];
            }[];
          };
        };
      };
    }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc?.elements[0]) {
          return c.source.doc.elements[0].id;
        }
      }
    }
    throw new Error(`找不到排版文档（clipId=${id}）`);
  }, { id: clipId });
}

/**
 * `clip-path: inset(0 50% 0 0)` 裁掉右半：
 *  - 只裁内容（缺省）⇒ 底板 300×100 完整 ⇒ 墨迹面积不变；
 *  - 裁到整块（`target:'box'`）⇒ 底板也少一半 ⇒ 墨迹降到约 50%。
 *
 * 只要动画层落在 `.typo-el` **之外**这两条就不可能同时成立。
 */
test('target:"box" 时 clip-path 裁到文本框底板；缺省只裁文字', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  const shots = await page.evaluate(
    async ({ clipId, w, h }) => {
      const A = (window as never as {
        __artmatic: {
          store: {
            project: {
              tracks: {
                clips: { id: string; source?: { type?: string; doc?: Record<string, unknown> } }[];
              }[];
            };
          };
          typoRasterize: (doc: unknown, w: number, h: number, t: number) => Promise<Shot>;
        };
      }).__artmatic;

      let doc: Record<string, unknown> | null = null;
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) {
          if (c.id === clipId && c.source?.type === 'text' && c.source.doc) doc = c.source.doc;
        }
      }
      if (!doc) throw new Error('找不到排版文档');

      const base = JSON.parse(JSON.stringify(doc)) as {
        size: { w: number; h: number };
        elements: Record<string, unknown>[];
      };
      base.size = { w, h };
      const el = base.elements[0]!;
      el.frame = { x: 50, y: 50, w: 300, h: 100, rot: 0 };
      el.boxFill = { kind: 'solid', color: '#ff0000' };
      el.style = { ...(el.style as Record<string, unknown>), fontSize: 32 };
      el.animations = [];

      const clipped = (target?: 'box' | 'content') => {
        const copy = JSON.parse(JSON.stringify(base)) as typeof base;
        copy.elements[0]!.animations = [
          {
            id: 'clip1',
            kind: 'tracks',
            prop: 'clip-path',
            keys: [
              { t: 0, v: 'inset(0 50% 0 0)' },
              { t: 1, v: 'inset(0 50% 0 0)' },
            ],
            delay: 0,
            duration: 1,
            iterations: 1,
            easing: 'linear',
            direction: 'normal',
            fill: 'both',
            ...(target ? { target } : {}),
          },
        ];
        return copy;
      };

      const plain = await A.typoRasterize(base, w, h, 0.5);
      const content = await A.typoRasterize(clipped('content'), w, h, 0.5);
      const boxed = await A.typoRasterize(clipped('box'), w, h, 0.5);
      // 新工程里用户看到的就是这一条：不传 target。
      const dflt = await A.typoRasterize(clipped(), w, h, 0.5);
      return { plain, content, box: boxed, dflt };
    },
    { clipId, w: DOC_W, h: DOC_H },
  );

  const plain = shots.plain as Shot;
  const content = shots.content as Shot;
  const boxed = shots.box as Shot;
  const dflt = shots.dflt as Shot;

  // 底板 300×100 = 30000 px。画布 400×200，底板之外全透明。
  expect(plain.ink, '底板应该整块画出来').toBeGreaterThan(25_000);
  expect(
    Math.abs(content.ink - plain.ink),
    'target:"content" 只裁内容：文本框底板必须完全不受影响',
  ).toBeLessThanOrEqual(2);
  expect(boxed.ink, 'target:"box" 时底板一起被裁掉一半').toBeLessThan(plain.ink * 0.6);
  expect(boxed.ink, '不该整块都没了（那说明裁错了层）').toBeGreaterThan(plain.ink * 0.4);
  expect(dflt.hash, '缺省必须就是 box —— 新工程不传 target 时用户看到的就是整块').toBe(
    boxed.hash,
  );
});

test('面板的层开关把动画层放到外壳之外；同一属性两层各一条互不顶掉', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  const elId = await firstElementId(page, clipId);

  // **不点按钮** = 缺省就是「元素框」：新工程的第一次动画必须整块动。
  await page.getByTestId('typo-kf-add-prop').click();
  await expect(page.getByTestId('typo-kf-track')).toHaveCount(1);

  const readDom = (): Promise<{
    wrapClass: string;
    wrapAnimId: string | null;
    wrapAnimationName: string;
    shellAnimationName: string;
    shellLeft: string;
    shellWidth: string;
    wrapCount: number;
    sameRect: boolean;
  }> =>
    page.evaluate(({ id }) => {
      const shell = document.querySelector(`.paper [data-el-id="${id}"]`) as HTMLElement | null;
      if (!shell) throw new Error(`舞台上找不到元素 ${id}`);
      const wrap = shell.parentElement;
      if (!wrap) throw new Error('元素没有父节点');
      const a = wrap.getBoundingClientRect();
      const b = shell.getBoundingClientRect();
      return {
        wrapClass: wrap.className,
        wrapAnimId: wrap.getAttribute('data-anim-id'),
        wrapAnimationName: getComputedStyle(wrap).animationName,
        shellAnimationName: getComputedStyle(shell).animationName,
        shellLeft: shell.style.left,
        shellWidth: shell.style.width,
        wrapCount: document.querySelectorAll('.paper .typo-box').length,
        sameRect:
          Math.abs(a.x - b.x) <= 0.5 &&
          Math.abs(a.y - b.y) <= 0.5 &&
          Math.abs(a.width - b.width) <= 0.5 &&
          Math.abs(a.height - b.height) <= 0.5,
      };
    }, { id: elId });

  const dom = await readDom();
  expect(dom.wrapClass, '动画层必须是包住外壳的 .typo-box').toContain('typo-box');
  expect(dom.wrapAnimId, 'CSS 动画按 data-anim-id 选中这一层').toBeTruthy();
  expect(dom.wrapAnimationName).toMatch(/^artmatic-a-/);
  expect(dom.shellAnimationName, '外壳不能再挂动画（transform 被 frame.rot 占用）').toBe('none');
  expect(dom.shellLeft, '几何由最外层承担，外壳退化成 inset:0（否则 left/top 算两遍）').toBe('0px');
  expect(dom.shellWidth).toBe('100%');
  expect(dom.sameRect, '包装层矩形必须与元素框完全一致（旋转中心才对）').toBe(true);

  /*
   * 换层：有轨道时按钮改的是**这条轨道**（`actions.setTrackTarget`），`target` 进
   * `docSignature` ⇒ 重建动画层。换成内容层后 `.typo-box` 消失、外壳恢复 frame 定位。
   */
  await page.getByTestId('typo-kf-target-toggle').click();
  await expect(page.getByTestId('typo-kf-track')).toHaveCount(1);
  const asContent = await readDom();
  expect(asContent.wrapCount, '换成内容层后不该再有 box 包装').toBe(0);
  expect(asContent.shellLeft, '外壳要拿回自己的 frame 定位').not.toBe('0px');

  // 再切回来：又包回外壳之外。
  await page.getByTestId('typo-kf-target-toggle').click();
  expect((await readDom()).wrapCount).toBe(1);

  /*
   * 同一属性在两层各一条（走控制平面，UI 不给这个入口）：两层各自独立、互不顶掉。
   * 这条同时守住「content 是显式字段」—— 写进去的那条必须原样留在文档里。
   */
  await page.evaluate(
    async ({ clipId, id }) => {
      const A = (window as never as {
        __artmatic: {
          control: {
            setTypographyAnimation: (
              clipId: string,
              elementId: string,
              input: unknown,
              mode: string,
            ) => Promise<unknown>;
          };
        };
      }).__artmatic;
      await A.control.setTypographyAnimation(
        clipId,
        id,
        { prop: 'opacity', keys: [{ t: 0, v: 0.5 }, { t: 0.6, v: 0.5 }], target: 'content' },
        'add',
      );
    },
    { clipId, id: elId },
  );
  await expect(page.getByTestId('typo-kf-track')).toHaveCount(2);

  const doubled = await page.evaluate(({ id }) => {
    const shell = document.querySelector(`.paper [data-el-id="${id}"]`) as HTMLElement | null;
    return {
      boxCount: document.querySelectorAll('.paper .typo-box').length,
      animCount: document.querySelectorAll('.paper .typo-anim').length,
      parentClass: shell?.parentElement?.className ?? '',
      outerLeft: shell?.parentElement?.style.left ?? '',
    };
  }, { id: elId });
  expect(doubled.boxCount, 'box 层仍只有一层').toBe(1);
  expect(doubled.animCount, 'content 层是外壳之内的 .typo-anim').toBe(1);
  expect(doubled.parentClass).toContain('typo-box');
  expect(doubled.outerLeft, '几何仍由最外层承担').not.toBe('0px');

  const targets = await page.evaluate(({ id }) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: {
            tracks: {
              clips: {
                id: string;
                source?: { type?: string; doc?: { elements: { id: string; animations: { target?: string }[] }[] } };
              }[];
            }[];
          };
        };
      };
    }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        const el = c.source?.doc?.elements.find((e) => e.id === id);
        if (el) return el.animations.map((a) => a.target ?? 'box').sort();
      }
    }
    return [];
  }, { id: elId });

  expect(targets, '两条同属性轨道分别落在 box 与 content').toEqual(['box', 'content']);
});
