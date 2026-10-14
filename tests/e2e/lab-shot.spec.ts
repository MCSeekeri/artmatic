import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { openDemo } from './_stage';
import { unzipSync } from 'fflate';

/**
 * 试炼场的「导出截图」。
 *
 * 存在的目的是把缩略图变成**预先准备好的静态图**：每次开选择器现渲七十多张
 * 会短暂压帧，而预先导出还顺带给了人工过一遍底图的机会。
 *
 * 这里盯的是三件**看起来能跑但会静默出错**的事：
 *   1. 文件名必须是**特效 id** —— 它是这份素材的主键，下一轮整合按它落盘；
 *      显示名会随文案变，用显示名当文件名的话一改文案就对不上代码了。
 *   2. 下载的必须是**真的 PNG** —— `toBlob` 失败时会拿到 null（或一个 0 字节
 *      文件），而「下载发生了」本身不会因此报错。
 *   3. 批量导出的 zip 必须**与注册表一一对应** —— 少一个或多一个都说明
 *      遍历用错了集合（比如遍历了 `EFFECT_CATALOG` 的键而与注册表漂开）。
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

interface LabHandle {
  list: () => { sources: string[]; effects: string[] };
  selectEffect: (id: string | null) => void;
  renderSize: () => { w: number; h: number };
}
type LabWindow = { __lab?: LabHandle };

async function boot(page: Page): Promise<void> {
  // 必须带尾斜杠（`/lab` 是给人手敲地址用的 302 兜底），见 AGENTS §3.1。
  await page.goto('/lab/');
  await page.waitForFunction(() => {
    const L = (window as unknown as LabWindow).__lab;
    return !!L && L.renderSize().w > 0;
  });
}

async function readDownload(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  if (!path) throw new Error('download 没有落到临时文件');
  return new Uint8Array(await readFile(path));
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** WebP：`RIFF` + 4 字节长度 + `WEBP`。 */
function isWebp(bytes: Uint8Array): boolean {
  return RIFF.every((b, i) => bytes[i] === b) && WEBP.every((b, i) => bytes[8 + i] === b);
}

test('lab 导出截图：文件名是特效 id，内容是合法 PNG', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => (window as unknown as LabWindow).__lab!.selectEffect('bleach'));
  // 等一帧，确保画布上是 bleich 的画面而不是上一次选择的
  await page.waitForTimeout(300);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('lab-shot').click(),
  ]);

  expect(download.suggestedFilename()).toBe('bleach.png');
  const bytes = await readDownload(download);
  expect(isPng(bytes)).toBe(true);
  // 「下载发生了」不等于「里面有东西」—— toBlob 出问题时会得到一个极小的文件
  expect(bytes.byteLength).toBeGreaterThan(2000);
});

test('lab 批量导出：一个 zip，与注册表一一对应，每张都是 WebP', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);

  const effectIds = (await page.evaluate(() =>
    (window as unknown as LabWindow).__lab!.list().effects,
  )) as string[];
  expect(effectIds.length).toBeGreaterThan(50);

  // 用小档位跑：这条用例验的是「遍历 + 打包 + 命名 + 编码」，不是画质
  await page.getByTestId('lab-shot-height').click();
  await page.getByTestId('lab-shot-height-opt-128').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('lab-shot-all').click(),
  ]);

  expect(download.suggestedFilename()).toBe('effect-thumbnails-128p.zip');

  const files = unzipSync(await readDownload(download));
  const names = Object.keys(files).sort();
  // 注意**先加后缀再排序**：`channel-split` 与 `channel-split-prism` 的先后
  // 会因为比的是 `-`(0x2D) 还是 `.`(0x2E) 而翻转 —— 排 id 再拼后缀得到的是另一个顺序。
  expect(names).toEqual(effectIds.map((id) => `${id}.webp`).sort());

  // 抽查若干张：每张都得是真的 WebP（打包对了但内容是空的，是另一类 bug）。
  // 导出的就是**进仓库的那套资源**，所以这条同时替 `effect-thumb-assets` 的
  // 格式断言做了「再来一次也还是 WebP」的回归。
  for (const name of [names[0]!, names[Math.floor(names.length / 2)]!, names[names.length - 1]!]) {
    expect(isWebp(files[name]!), `${name} 不是 WebP`).toBe(true);
    expect(files[name]!.byteLength, `${name} 太小`).toBeGreaterThan(200);
  }
});

/**
 * 守的是**导出这条渲染路径**本身：渲染 → 读回 → 翻行 → 编码。
 * 选择器的 E2E 不管这些 —— 那边贴的是静态资源，压根没有渲染。
 */
test('lab 批量导出：产出的图方向正确，且频谱类没把链输入顶掉', async ({ page }) => {
  test.setTimeout(300_000);
  await boot(page);

  await page.getByTestId('lab-shot-height').click();
  await page.getByTestId('lab-shot-height-opt-128').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('lab-shot-all').click(),
  ]);
  const files = unzipSync(await readDownload(download));

  /**
   * 把 zip 里的一个条目解码到 canvas 上读回像素。
   *
   * 解码必须发生在页面里（那里才有 WebP 解码器），所以这一趟是「把 data URL
   * 递进去、把原始像素取回来」。128p 一帧约 116 KB，过界没有压力；
   * 统计放在 Node 侧算，**不要在 page 里 eval 字符串**（CSP 一挡就废）。
   */
  const pixels = async (name: string): Promise<{ d: Uint8ClampedArray; w: number; h: number }> => {
    const bytes = files[name];
    if (!bytes) throw new Error(`zip 里没有 ${name}`);
    const url = `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
    const raw = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height);
      return { d: Array.from(px.data), w: px.width, h: px.height };
    }, url);
    return { d: Uint8ClampedArray.from(raw.d), w: raw.w, h: raw.h };
  };

  /** 某一横带的平均饱和度（0 = 完全灰，1 = 满饱和）。 */
  const bandSat = (d: Uint8ClampedArray, w: number, y0: number, y1: number): number => {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const mx = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
        const mn = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
        sum += mx > 20 ? (mx - mn) / mx : 0;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  };

  /*
   * ① 方向。
   *
   * `readPixels` 是自下而上的（GL 原点在左下），而 `ImageData` 第 0 行在顶部 ——
   * 漏了翻行的话每张都是倒的。探针用 `pixelate`：它的目录底图是 `ramp`
   * （**上 50% 灰阶斜坡、下 50% 彩色斜坡**），所以「下半比上半彩色」是一个
   * 与内容无关的方向判据，翻转之后关系会反过来。
   */
  const px = await pixels('pixelate.webp');
  const gap = bandSat(px.d, px.w, Math.floor(px.h * 0.65), px.h) -
    bandSat(px.d, px.w, 0, Math.floor(px.h * 0.35));
  expect(gap, '下半该比上半彩色 —— 反过来就说明导出被上下翻转了').toBeGreaterThan(0.2);

  /*
   * ② 频谱纹理没顶掉链输入。
   *
   * `u_spectrum` 是 R8，被当成 RGBA 读会得到 `(r,0,0,1)` —— 一整片红。
   * 实测过的事故：`SpectrumTextures.bindTo` 首次为实例建纹理时，
   * `makeTexture` 里的 `bindTexture` 作用在当前激活单元上，而那个单元正是
   * `prog.tex('u_texture', ...)` 留下的 0 号 —— 频谱把**链输入**换掉了。
   * 只在第一帧发生，所以连续渲染的用例看不见；这边取的就是定格帧。
   */
  const bar = await pixels('audio-bars.webp');
  let red = 0;
  let total = 0;
  for (let i = 0; i < bar.d.length; i += 4) {
    const r = bar.d[i]!;
    const g = bar.d[i + 1]!;
    const b = bar.d[i + 2]!;
    if (r > g + 40 && r > b + 40) red += 1;
    total += 1;
  }
  expect(red / total, '整片发红 → u_texture 被频谱纹理顶掉了').toBeLessThan(0.2);
});
