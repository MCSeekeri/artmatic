import { expect, test, type Page } from '@playwright/test';
import { buildStage, hashAt, meanAt, renderTwiceDiff, settle, waitForSourceReady } from './_stage';
import { decodePattern, liveCount } from '../../src/algos/pattern-codec';
import { presetParamValue } from '../../src/algos/pattern-presets';

/**
 * 扩展后的参数体系：规则位表（0~255 / B/S）与手绘种子图案。
 *
 * 两类断言分工明确，**不能互相替代**（AGENTS §6.3）：
 *  - 渲染断言（GPU 读回标量）证明「参数真的改变了画面」；
 *  - DOM 断言证明「用户看得见、点得动」—— store 改了不等于界面改了。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

/** 选中某个片段，让检查器渲染出它的参数。 */
async function selectClip(page: Page, clipId: string): Promise<void> {
  await page.evaluate((id) => {
    (window as never as { __artmatic: { appState: { selectedClipId: string | null } } }).__artmatic.appState.selectedClipId = id;
  }, clipId);
}

interface ClipParamsApi {
  __artmatic: {
    appState: { selectedClipId: string | null };
    store: {
      /** ⚠️ `findClip` 返回的是 `{ track, clip }` 包，不是 clip 本身。 */
      findClip: (
        id: string,
      ) => { clip: { source: { params: Record<string, number | string> } } } | null;
    };
  };
}

async function paramOf(page: Page, clipId: string, key: string): Promise<number | string | undefined> {
  return page.evaluate(
    ({ id, k }) => {
      const found = (window as never as ClipParamsApi).__artmatic.store.findClip(id);
      return found?.clip.source.params[k];
    },
    { id: clipId, k: key },
  );
}

/* ------------------------------------------------------------ 渲染：规则 */

test('rule110：自定义规则号改变画面，且逐帧确定', async ({ page }) => {
  await boot(page);
  const base = { width: 320, height: 160, seedMode: 'single', speed: 96, wrap: 1, colorMode: 'binary' };

  await buildStage(page, {
    id: 'eca-30',
    source: { type: 'algo', generator: 'rule110', params: { ...base, rule: 30 } },
    end: 8,
  });
  await waitForSourceReady(page, 6, { minMean: 1 });
  const h30 = await hashAt(page, 6);

  await buildStage(page, {
    id: 'eca-110',
    source: { type: 'algo', generator: 'rule110', params: { ...base, rule: 110 } },
    end: 8,
  });
  await waitForSourceReady(page, 6, { minMean: 1 });
  const h110 = await hashAt(page, 6);

  // 同一个位表控件的两个值必须产出不同的图 —— 否则「规则可调」是假的
  expect(h30).not.toBe(h110);
  // 同帧重渲逐像素一致（烘焙是确定性的）
  expect(await renderTwiceDiff(page, 6, true)).toBe(0);
});

test('rule110：代际着色与二值着色是两张不同的图', async ({ page }) => {
  await boot(page);
  const base = { width: 320, height: 160, rule: 30, seedMode: 'single', speed: 96, wrap: 1 };
  await buildStage(page, {
    id: 'eca-bin',
    source: { type: 'algo', generator: 'rule110', params: { ...base, colorMode: 'binary' } },
    end: 8,
  });
  await waitForSourceReady(page, 6, { minMean: 1 });
  const bin = await meanAt(page, 6);

  await buildStage(page, {
    id: 'eca-age',
    source: { type: 'algo', generator: 'rule110', params: { ...base, colorMode: 'age' } },
    end: 8,
  });
  await waitForSourceReady(page, 6, { minMean: 1 });
  const age = await meanAt(page, 6);

  // 代际着色把「活/死」变成了 1..255 的梯度，平均亮度必然不同
  expect(Math.abs(age - bin)).toBeGreaterThan(0.5);
});

/* --------------------------------------------------- 渲染：手绘种子图案 */

test('生命游戏：手绘滑翔机落上网格，且与随机撒种不同', async ({ page }) => {
  await boot(page);
  const common = { size: 64, rate: 12 };
  const pattern = presetParamValue('glider');

  await buildStage(page, {
    id: 'gol-pattern',
    source: { type: 'algo', generator: 'game-of-life', params: { ...common, seedMode: 'pattern', pattern } },
    end: 8,
  });
  // sim 型是主线程同步的，没有异步烘焙要等 —— settle 把它渲到稳定即可。
  // （这里**不能**用 waitForSourceReady：meanAt 的 minMean 判据是给整幅
  // 非黑准备的，而 5 个细胞在 64 网格上只占约 0.1% 的画面。）
  await settle(page, 0);
  const hPattern = await hashAt(page, 0);
  expect(await meanAt(page, 0)).toBeGreaterThan(0);

  await buildStage(page, {
    id: 'gol-random',
    source: { type: 'algo', generator: 'game-of-life', params: { ...common, seedMode: 'random', density: 0.42 } },
    end: 8,
  });
  await settle(page, 0);
  const hRandom = await hashAt(page, 0);

  expect(hPattern).not.toBe(hRandom);
  // 手绘种子不消耗 RNG ⇒ 同帧重渲必须逐像素一致
  expect(await renderTwiceDiff(page, 0, true)).toBe(0);
});

test('生命游戏：B/S 规则族（HighLife）与邻域切换都改变画面', async ({ page }) => {
  await boot(page);
  const common = { size: 64, rate: 12, seedMode: 'random', density: 0.45 };
  const conway = 6152;
  const highLife = 6216; // B36/S23

  await buildStage(page, {
    id: 'gol-conway',
    source: { type: 'algo', generator: 'game-of-life', params: { ...common, mask: conway } },
    end: 8,
  });
  await settle(page, 4);
  const hConway = await hashAt(page, 4);

  await buildStage(page, {
    id: 'gol-high',
    source: { type: 'algo', generator: 'game-of-life', params: { ...common, mask: highLife } },
    end: 8,
  });
  await settle(page, 4);
  const hHigh = await hashAt(page, 4);

  await buildStage(page, {
    id: 'gol-vn',
    source: {
      type: 'algo',
      generator: 'game-of-life',
      params: { ...common, mask: conway, neighborhood: 'vonNeumann' },
    },
    end: 8,
  });
  await settle(page, 4);
  const hVn = await hashAt(page, 4);

  expect(hConway).not.toBe(hHigh);
  expect(hConway).not.toBe(hVn);
});

/* ------------------------------------------------------ DOM：规则位表控件 */

test('位表控件：点一行翻转那一位，数值框跟着走；反向输入也联动手位', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'eca-dom',
    source: { type: 'algo', generator: 'rule110', params: { width: 128, height: 64 } },
    end: 8,
  });
  await selectClip(page, 'eca-dom');

  const num = page.getByTestId('algo-param-rule-num');
  await expect(num).toBeVisible();
  expect(await num.inputValue(), '默认应是 Rule 110').toBe('110');

  // bit7 是最高位（■■■ 那一行）。110 < 128 ⇒ 它是 0；点一下应当变成 110|128 = 238
  const bit7 = page.getByTestId('algo-param-rule-bit-7');
  await expect(bit7).toHaveAttribute('aria-pressed', 'false');
  await bit7.click();
  expect(await num.inputValue()).toBe('238');
  await expect(bit7).toHaveAttribute('aria-pressed', 'true');

  // 反向：直接输 30（= 00011110₂）→ bit7 熄灭、bit4 点亮
  await num.fill('30');
  await num.press('Enter');
  await expect(page.getByTestId('algo-param-rule-bit-7')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('algo-param-rule-bit-4')).toHaveAttribute('aria-pressed', 'true');
});

test('位表预设按钮把规则号一次写好', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'eca-preset',
    source: { type: 'algo', generator: 'rule110', params: { width: 128, height: 64 } },
    end: 8,
  });
  await selectClip(page, 'eca-preset');

  const num = page.getByTestId('algo-param-rule-num');
  await expect(num).toBeVisible();
  // 预设顺序 = RULE_PRESETS：0:30 · 1:45 · 2:54 · 3:60 · 4:90 · 5:110 · 6:150 · 7:184 · 8:250
  await page.getByTestId('algo-param-rule-preset-4').click();
  expect(await num.inputValue()).toBe('90');
});

/* ------------------------------------------------ DOM：手绘种子图案编辑器 */

test('图案编辑器：画一笔并应用，缩略图与 store 都跟着变', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'gol-draw',
    source: {
      type: 'algo',
      generator: 'game-of-life',
      params: { size: 64, rate: 12, seedMode: 'pattern', pattern: '' },
    },
    end: 8,
  });
  await selectClip(page, 'gol-draw');

  const thumb = page.getByTestId('algo-param-pattern-thumb');
  await expect(thumb).toBeVisible();
  const before = await thumb.evaluate((el) => (el as HTMLCanvasElement).toDataURL());

  await page.getByTestId('algo-param-pattern-edit').click();
  const canvas = page.getByTestId('pattern-editor-canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();

  // 真的用鼠标画一笔（不是直接改 state）：这条覆盖的是指针→格映射 + 补线
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + 6;
  await page.mouse.move(box!.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, y, { steps: 8 });
  await page.mouse.up();

  await page.getByTestId('pattern-editor-apply').click();
  await expect(page.getByTestId('pattern-editor')).toHaveCount(0);

  const after = await thumb.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  // 缩略图必须真的重绘过 —— 只断言 store 抓不到「改了文档没改 DOM」
  expect(after).not.toBe(before);

  const stored = await paramOf(page, 'gol-draw', 'pattern');
  expect(typeof stored).toBe('string');
  const bm = decodePattern(String(stored));
  expect(bm, 'store 里的图案串应当可解码').not.toBeNull();
  expect(liveCount(bm!), '画过的那一笔应当留下活格').toBeGreaterThan(0);
});

test('图案编辑器：预设与清空按钮各司其职', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'gol-preset',
    source: {
      type: 'algo',
      generator: 'game-of-life',
      params: { size: 64, rate: 12, seedMode: 'pattern', pattern: '' },
    },
    end: 8,
  });
  await selectClip(page, 'gol-preset');

  await page.getByTestId('algo-param-pattern-edit').click();
  await page.getByTestId('pattern-editor-preset-glider').click();
  await page.getByTestId('pattern-editor-apply').click();

  const stored = await paramOf(page, 'gol-preset', 'pattern');
  const bm = decodePattern(String(stored));
  expect(bm).not.toBeNull();
  expect(liveCount(bm!), '滑翔机是 5 个细胞').toBe(5);

  // 「清空」把参数打回空串（= 无图案），且按钮随之换成「未绘制」
  await page.getByTestId('algo-param-pattern-clear').click();
  expect(await paramOf(page, 'gol-preset', 'pattern')).toBe('');
  await expect(page.getByTestId('algo-param-pattern-clear')).toHaveCount(0);
});

/* ------------------------------------------------------ DOM：试炼场也要接上 */

test('试炼场：新参数类型渲染成真正的控件（不是被 else 兜成颜色选择器）', async ({ page }) => {
  await page.goto('/lab/');
  await page.waitForFunction(() => (window as never as { __lab?: unknown }).__lab);

  const selectSource = async (id: string): Promise<void> => {
    await page.evaluate((sid) => {
      (window as never as { __lab: { selectSource: (s: string) => void } }).__lab.selectSource(sid);
    }, id);
  };

  // rule110：位表 + 数值框
  await selectSource('rule110');
  const num = page.getByTestId('lab-source-bitmask-rule-num');
  await expect(num).toBeVisible();
  expect(await num.inputValue()).toBe('110');
  await page.getByTestId('lab-source-bitmask-rule-bit-7').click();
  expect(await num.inputValue()).toBe('238');
  // 兜底成颜色选择器的话，这个 testid 根本不存在 —— 那正是要抓的失败
  await expect(page.getByTestId('lab-source-color-rule')).toHaveCount(0);

  // 生命游戏：图案参数
  await selectSource('game-of-life');
  await page.evaluate(() => {
    (window as never as { __lab: { setParam: (s: string, k: string, v: string) => void } }).__lab.setParam(
      'source',
      'seedMode',
      'pattern',
    );
  });
  await expect(page.getByTestId('lab-source-pattern-pattern')).toBeVisible();
  await page.getByTestId('lab-source-pattern-pattern-edit').click();
  await expect(page.getByTestId('pattern-editor-canvas')).toBeVisible();
  await page.getByTestId('pattern-editor-preset-pulsar').click();
  await page.getByTestId('pattern-editor-apply').click();
  await expect(page.getByTestId('pattern-editor')).toHaveCount(0);
  await expect(page.getByTestId('lab-source-pattern-pattern-alive')).not.toHaveText('0');
});
