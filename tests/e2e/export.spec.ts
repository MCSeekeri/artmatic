import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

/**
 * 导出帧 vs 预览帧：同一渲染入口（renderFrame）在导出分辨率下
 * 渲一次得到预览参考，导出的 PNG 是另一次结果——两者必须只差
 * PNG 编码往返的噪声。所有大像素数据留在 page 内，只回传标量。
 */

test('导出 PNG 序列：帧数正确，且与预览同帧差在噪声级', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);

  const result = await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: {
        store: { setDuration: (s: number) => void };
        renderer: {
          setExportSize: (w: number, h: number) => void;
          clearExportSize: () => void;
          readPixels: () => { data: Uint8Array; w: number; h: number };
        };
        renderFrame: (t: number) => void;
        exportFrames: () => Promise<Record<string, number[]>>;
      };
    }).__artmatic;

    A.store.setDuration(0.5); // 15 帧 @30fps

    // 预览参考：导出分辨率下渲第 7 帧
    A.renderer.setExportSize(1920, 1080);
    A.renderFrame(7 / 30);
    const ref = A.renderer.readPixels();
    A.renderer.clearExportSize();

    // 真实导出管线（不走下载）
    const frames = await A.exportFrames();
    const names = Object.keys(frames).sort();

    const f7 = new Uint8Array(frames['frame_00007.png']!);
    const blob = new Blob([f7.buffer as ArrayBuffer], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height).data;

    let sum = 0;
    let maxD = 0;
    const n = Math.min(img.length, ref.data.length);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(img[i]! - ref.data[i]!);
      sum += d;
      if (d > maxD) maxD = d;
    }
    return {
      count: names.length,
      first: names[0],
      sameSize: img.length === ref.data.length,
      mean: sum / n,
      max: maxD,
    };
  });

  expect(result.count).toBe(15);
  expect(result.first).toBe('frame_00000.png');
  expect(result.sameSize).toBe(true);
  expect(result.mean).toBeLessThan(2); // 均值差 < 2/255（噪声级）
  expect(result.max).toBeLessThan(24); // 单点容差（边缘 AA 像素）
});

test('导出按钮触发浏览器下载（真实下载路径）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { setDuration: (s: number) => void } };
    }).__artmatic;
    A.store.setDuration(0.2); // 6 帧，跑快点
  });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-png').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const path = await download.path();
  const zip = unzipSync(new Uint8Array(await readFile(path!)));
  expect(Object.keys(zip).filter((n) => n.endsWith('.png'))).toHaveLength(6);
});
