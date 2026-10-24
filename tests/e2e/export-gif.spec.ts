import { expect, test } from '@playwright/test';
import { openDemo, waitForSourceReady } from './_stage';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * GIF 导出 E2E。
 *
 * ## 磁盘纪律（与 export-mp4.spec 同一套，先读那段）
 *
 * 这个 spec 会**真的产出 GIF 文件**。GIF 是**未压缩的索引数据 + LZW**，
 * 同样的画幅下体积比 H.264 大一个量级，所以这里比 MP4 那条更需要克制：
 * 320×180 / 0.5s，产物落 `os.tmpdir()`，`afterEach` 无条件删目录。
 *
 * ## 为什么断言要真的解析块结构
 *
 * GIF 是**可顺序遍历**的块格式（扩展块 / 图像描述符 / trailer），而 LZW 压缩
 * 数据里 0x2C 会大量出现 —— 「数 0x2C 的个数」得到的"帧数"能上千，毫无意义。
 * 按规范走一遍块结构才是唯一可靠的判据，而且这个遍历顺带证明了**结构合法**：
 * 走岔一步后面全乱，遇到不认识的标记就会提前退出，帧数与长度立刻对不上。
 *
 * 这也正是「用浏览器 `<img>` 加载一下能显示」证明不了的东西 —— 那张图可能
 * 只有第一帧是对的。
 */

const TMP_DIR = join(tmpdir(), 'artmatic-e2e-gif');

test.afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

/** 极小的工程配置：320×180、0.5s。够验证结构，不占磁盘。 */
async function setupTinyProject(page: import('@playwright/test').Page): Promise<number> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  /*
   * demo 含 bake 型生成器：等它真的落地，而不是睡固定 2.5s。
   *
   * 固定等待在这里是纯浪费 —— 这些用例断的是容器结构、文案与编码器阶梯，
   * 与画面内容无关，但每条都要付一次「睡够为止」；而负载高时 2.5s 又未必够
   * （`_stage.ts::waitForSourceReady` 的注释记了那次偶发失败的成因）。
   */
  await waitForSourceReady(page, 0);
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          setResolution: (w: number, h: number) => void;
          setDuration: (s: number) => void;
          project: { fps: number };
        };
      };
    }).__artmatic;
    A.store.setResolution(320, 180);
    A.store.setDuration(0.5);
    return A.store.project.fps;
  });
}

interface GifInfo {
  magic: string;
  width: number;
  height: number;
  frames: number;
  /** 逐帧延迟（厘秒），下标对应帧。 */
  delaysCs: number[];
  /** NETSCAPE 扩展里的循环次数；null 表示没有该扩展。0 = 无限循环。 */
  loopCount: number | null;
  hasTrailer: boolean;
  /** 带局部色表的帧数。 */
  localColorTables: number;
  globalColorTable: boolean;
}

/**
 * 最小 GIF 解析器：只按块结构遍历，不解 LZW。
 *
 * 位置常量全部照 GIF89a 规范：header(6) + 逻辑屏描述符(7)，之后的块以
 * `0x21`(扩展) / `0x2C`(图像描述符) / `0x3B`(trailer) 开头。
 */
function parseGif(bytes: Uint8Array): GifInfo {
  const u16 = (i: number): number => bytes[i]! | (bytes[i + 1]! << 8);

  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  const width = u16(6);
  const height = u16(8);
  const lsdPacked = bytes[10]!;

  let p = 13; // header(6) + 逻辑屏描述符(7)
  const globalColorTable = (lsdPacked & 0x80) !== 0;
  if (globalColorTable) p += 3 * (1 << ((lsdPacked & 0x07) + 1));

  const info: GifInfo = {
    magic,
    width,
    height,
    frames: 0,
    delaysCs: [],
    loopCount: null,
    hasTrailer: false,
    localColorTables: 0,
    globalColorTable,
  };

  /** 跳过一串「长度字节 + 数据」子块，返回终止符之后的位置。 */
  const skipSubBlocks = (from: number): number => {
    let i = from;
    while (i < bytes.length) {
      const len = bytes[i]!;
      i += 1;
      if (len === 0) return i;
      i += len;
    }
    return i;
  };

  let pendingDelayCs = 0;
  while (p < bytes.length) {
    const marker = bytes[p]!;

    if (marker === 0x3b) {
      info.hasTrailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = bytes[p + 1]!;
      if (label === 0xf9) {
        // 图形控制扩展：块大小(1) + packed(1) + delay(2) + 透明索引(1) + 终止(1)
        pendingDelayCs = u16(p + 4);
      } else if (label === 0xff) {
        // 应用扩展：块大小(1) + "NETSCAPE2.0"(11) + 子块(3, 1, loop u16)
        if (bytes[p + 3 + 11] === 3) info.loopCount = u16(p + 3 + 11 + 2);
      }
      p = skipSubBlocks(p + 2);
      continue;
    }
    if (marker === 0x2c) {
      // 图像描述符：左(2) 上(2) 宽(2) 高(2) packed(1)
      const imgPacked = bytes[p + 9]!;
      let q = p + 10;
      if (imgPacked & 0x80) {
        info.localColorTables += 1;
        q += 3 * (1 << ((imgPacked & 0x07) + 1));
      }
      q += 1; // LZW 最小码长
      p = skipSubBlocks(q);
      info.frames += 1;
      info.delaysCs.push(pendingDelayCs);
      continue;
    }
    // 不认识的标记：结构已经乱了。停下，让帧数与后面的断言去报错。
    break;
  }

  return info;
}

/**
 * 从区间行末尾读出「这次会写多少帧」。
 *
 * 它来自 `gifPlan`，而真正写进文件的帧数必须与它一致 —— 这个读数是下面
 * 「产物帧数 == 面板帧数」那条断言的另一半。
 */
async function gifPlannedFrames(page: import('@playwright/test').Page): Promise<number> {
  const text = (await page.getByTestId('gif-frames').textContent()) ?? '';
  const m = /(\d+)/.exec(text);
  expect(m, `帧数提示里没有数字：「${text}」`).not.toBeNull();
  return Number(m![1]);
}

test('GIF 导出：产物是合法 GIF89a，尺寸 / 帧数 / 循环 / 色表与面板一致', async ({ page }) => {
  const fps = await setupTinyProject(page);
  const sourceFrames = Math.max(1, Math.ceil(0.5 * fps));

  await page.getByTestId('rail-export').click();

  // 先从面板读帧数：它来自 gifPlan，产物必须与它对得上。
  // 这条比"帧数等于某个常量"有用得多 —— 它同时钉住了「提示与产物同源」。
  const plannedFrames = await gifPlannedFrames(page);
  expect(plannedFrames).toBeGreaterThan(0);
  // 抽帧真的生效：GIF 的帧数必须**明显少于**工程帧数。
  expect(plannedFrames).toBeLessThan(sourceFrames);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gif').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gif$/);

  await mkdir(TMP_DIR, { recursive: true });
  const dest = join(TMP_DIR, 'out.gif');
  await download.saveAs(dest);
  const bytes = new Uint8Array(await readFile(dest));
  const info = parseGif(bytes);

  // 1. 魔数：这真的是 GIF89a（不是 GIF87a，NETSCAPE 循环块只在 89a 里）。
  expect(info.magic).toBe('GIF89a');

  // 2. 逻辑屏尺寸 = 480 宽，高度按 320×180 的宽高比换算 → 270。
  expect({ w: info.width, h: info.height }).toEqual({ w: 480, h: 270 });

  // 3. 帧数与面板提示一致，且结构遍历走完了（trailer 找到了）。
  expect(info.frames).toBe(plannedFrames);
  expect(info.hasTrailer).toBe(true);
  expect(info.delaysCs).toHaveLength(info.frames);

  // 3b. 反例守卫：证明「数 0x2C 字节」这条捷径**真的不可用**。
  // 没有这条，上面的块遍历迟早会被后人当成过度设计删掉 —— 而它删掉之后
  // 测试照样是绿的，只是再也测不到帧数。
  const naiveCount = bytes.filter((b) => b === 0x2c).length;
  expect(naiveCount).toBeGreaterThan(info.frames);

  // 4. 无限循环：NETSCAPE 块存在且 count = 0。
  expect(info.loopCount).toBe(0);

  // 5. 色表策略：第一帧写全局色表，之后每帧一张**局部**色表
  //    （逐帧量化的直接后果；若哪天改成全局共享，这条会先红）。
  expect(info.globalColorTable).toBe(true);
  expect(info.localColorTables).toBe(info.frames - 1);

  // 6. 时长量级正确：0.5s 的工程不该导出成 5s 或 0.05s。
  //    精确对齐由单测 gif-plan.test.ts 钉（那条能控住整数帧数）；这里只挡
  //    「差了数量级」这种结构性错误。
  const totalCs = info.delaysCs.reduce((a, b) => a + b, 0);
  expect(totalCs).toBeGreaterThan(45);
  expect(totalCs).toBeLessThan(56);

  // 7. 磁盘纪律守卫：320×180×0.5s 的 GIF 应在几百 KB 内。
  expect(bytes.byteLength).toBeLessThan(2_000_000);
});

test('GIF 面板：默认档位 / 尺寸换算 / 改宽度 / 改帧率，读数都跟着 plan 走', async ({ page }) => {
  await setupTinyProject(page);
  await page.getByTestId('rail-export').click();

  // 默认 480 宽 → 320×180 的工程得到 480×270。
  await expect(page.getByTestId('gif-size')).toHaveText('480×270');
  await expect(page.getByTestId('gif-fps')).toContainText('12.5 fps');

  // 换成 240 宽：尺寸提示必须同步（它读的是同一个 gifPlan）。
  await page.getByTestId('gif-width').click();
  await page.getByTestId('gif-width-opt-240').click();
  await expect(page.getByTestId('gif-size')).toHaveText('240×135');
  await expect(page.getByTestId('gif-width')).toContainText('240px');

  /*
   * 再改帧率：帧数提示必须跟着变。
   *
   * 这两段以前是两条用例 —— 同一形态（下拉换值 → 面板文本变），**都不渲画面**，
   * 却各付一次示例工程的建立成本。合起来只开一次面板。
   */
  const before = await gifPlannedFrames(page);
  await page.getByTestId('gif-fps').click();
  await page.getByTestId('gif-fps-opt-25').click();
  const after = await gifPlannedFrames(page);
  // 12.5fps 与 25fps 的抽帧步长必不相同（工程帧率至少 24），所以帧数必然变。
  expect(after).not.toBe(before);
});


test('GIF 区间：只导后半段，帧数与播放时长都跟着缩短', async ({ page }) => {
  await setupTinyProject(page);
  await page.getByTestId('rail-export').click();

  const wholeFrames = await gifPlannedFrames(page);

  // 0.5s 的工程只导 0.25–0.5 这一段。
  // NumberInput 的 testid 落在内部 input 上，fill + Enter 就是真实提交路径。
  await page.getByTestId('gif-start').fill('0.25');
  await page.getByTestId('gif-start').press('Enter');

  const rangeFrames = await gifPlannedFrames(page);
  expect(rangeFrames).toBeGreaterThan(0);
  expect(rangeFrames).toBeLessThan(wholeFrames);

  // 面板说多少帧，产物就得是多少帧 —— 这条同时钉住了「秒 → 帧号的换算
  // 只有 gif-plan 一处」这个约定。
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gif').click();
  const download = await downloadPromise;

  await mkdir(TMP_DIR, { recursive: true });
  const dest = join(TMP_DIR, 'range.gif');
  await download.saveAs(dest);
  const info = parseGif(new Uint8Array(await readFile(dest)));

  expect(info.frames).toBe(rangeFrames);
  // 后半段 = 0.25s = 25cs。留出一个抽帧间隔的余量：末帧是 `ceil` 出来的，
  // 最多可能多覆盖一个 step 的时间。
  const totalCs = info.delaysCs.reduce((a, b) => a + b, 0);
  expect(totalCs).toBeGreaterThan(20);
  expect(totalCs).toBeLessThan(30);
});
