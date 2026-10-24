import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * 排版元素的 3D 变换（元素属性面板 → CSS transform）。
 *
 * 断言分两层（AGENTS §6.3）：
 *   1. **光栅化**（`typoRasterize`，不经过 GPU）：透视压缩 / 靠近放大真的改变了
 *      墨迹数 —— 单测只钉字符串，这一条钉「浏览器真的这么渲」；
 *   2. **DOM**：勾选「启用 3D 变换」后 `.typo-el` 的内联 transform 变成预期字符串，
 *      取消勾选后 `transform-origin` / `transform` 都复位（就地同步没有删除语义）。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface Hooks {
  store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } };
  appState: { activeTypoClipId: string | null };
  typoRasterize: (
    doc: unknown,
    w: number,
    h: number,
    localSec: number,
  ) => Promise<{ w: number; h: number; ink: number; sum: number; hash: string }>;
}

/** 640×360 画幅里一块 200×200 的白方块，居中。 */
const SQUARE_DOC = {
  size: { w: 640, h: 360 },
  background: { kind: 'none' },
  elements: [
    {
      kind: 'shape',
      id: 'sq',
      name: 'sq',
      frame: { x: 220, y: 80, w: 200, h: 200, rot: 0 },
      blend: 'normal',
      opacity: 1,
      visible: true,
      locked: false,
      animations: [],
      shape: 'rect',
      fill: { kind: 'solid', color: '#ffffff' },
      stroke: null,
    },
  ],
  fonts: [],
};

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

/** 第一个 `.typo-el` 的**内联**样式（`elementStyle` 的唯一出口就是它）。 */
async function domBox(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.paper [data-el-id]');
    if (!el) return null;
    return {
      transform: el.style.transform,
      transformOrigin: el.style.transformOrigin,
      backface: el.style.backfaceVisibility,
      style: el.style.transformStyle,
      computed: getComputedStyle(el).transform,
    };
  });
}

test('3D 进入光栅化：透视压缩与靠近放大都真实生效', async ({ page }) => {
  await boot(page);

  const result = await page.evaluate(
    async ({ doc }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const base = () => {
        const t3 = {
          perspective: 800,
          translate: { x: 0, y: 0, z: 0 },
          rotate: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          skew: { x: 0, y: 0 },
          origin: { x: 0.5, y: 0.5 },
          backface: 'visible',
          style: 'flat',
        };
        const d = JSON.parse(JSON.stringify(doc)) as typeof doc & {
          elements: { transform3d?: unknown }[];
        };
        d.elements[0]!.transform3d = t3;
        return d;
      };
      const withT3 = (patch: Record<string, unknown>) => {
        const d = base();
        Object.assign(d.elements[0]!.transform3d as Record<string, unknown>, patch);
        return d;
      };
      const plain = JSON.parse(JSON.stringify(doc));

      return {
        flat: await A.typoRasterize(plain, 640, 360, 0),
        again: await A.typoRasterize(plain, 640, 360, 0),
        enabledIdentity: await A.typoRasterize(base(), 640, 360, 0),
        tilt: await A.typoRasterize(withT3({ rotate: { x: 0, y: 60, z: 0 } }), 640, 360, 0),
        near: await A.typoRasterize(withT3({ translate: { x: 0, y: 0, z: 200 } }), 640, 360, 0),
      };
    },
    { doc: SQUARE_DOC },
  );

  // 200×200 的方块：墨迹在 4 万左右（抗锯齿边缘多算一点）。
  expect(result.flat.ink).toBeGreaterThan(36_000);
  expect(result.flat.ink).toBeLessThan(44_000);

  // 无 3D 时仍然确定（同参数两次逐字节相同）。
  expect(result.again.hash).toBe(result.flat.hash);

  // 勾了启用但全恒等：perspective(800px) 是单位矩阵，画面必须与没启用一致。
  expect(result.enabledIdentity.hash).toBe(result.flat.hash);

  // 绕 Y 转 60°：正投影宽度乘 cos60 ≈ 0.5，面积明显变小。
  expect(result.tilt.ink).toBeLessThan(result.flat.ink * 0.75);
  expect(result.tilt.ink).toBeGreaterThan(0);

  // 沿 +Z 靠近相机 200（透视 800）⇒ 放大 800/(800−200) ≈ 1.33，面积 ×1.78。
  expect(result.near.ink).toBeGreaterThan(result.flat.ink * 1.2);
});

test('元素属性面板：启用 3D 后写入 transform，参数与复位都对', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  // 走图层面板选中第一个元素（与用户路径一致）。
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
  await page.getByTestId('typo-tab-props').click();

  const before = await domBox(page);
  expect(before!.transform).toBe('none');

  await page.getByTestId('prop-3d-enable').click();
  // 默认 800 透视 + 全恒等 ⇒ 只有 perspective（单位矩阵）。
  expect((await domBox(page))!.transform).toBe('perspective(800px)');

  const roty = page.getByTestId('prop-3d-roty');
  await roty.fill('60');
  await roty.press('Enter');
  expect((await domBox(page))!.transform).toBe('perspective(800px) rotateY(60deg)');

  const persp = page.getByTestId('prop-3d-persp');
  await persp.fill('1200');
  await persp.press('Enter');
  expect((await domBox(page))!.transform).toBe('perspective(1200px) rotateY(60deg)');

  // 浏览器真的接受这条 transform（不是写了但被丢弃）。
  expect((await domBox(page))!.computed.startsWith('matrix3d')).toBe(true);

  // 关闭：就地同步只 set 不 delete ⇒ 三个键都必须复位成 CSS 默认值。
  await page.getByTestId('prop-3d-enable').click();
  const after = await domBox(page);
  expect(after!.transform).toBe('none');
  expect(after!.transformOrigin).toBe('50% 50%');
  expect(after!.backface).toBe('visible');
  expect(after!.style).toBe('flat');
});
