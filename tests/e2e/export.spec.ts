import { expect, test } from '@playwright/test';
import { openDemo } from './_stage';
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
  await openDemo(page);
  // demo 含 bake 型生成器：被动等烘焙落地再比帧（见 determinism.spec 的注释）
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: {
        store: { setDuration: (s: number) => void };
        appState: { exportProgress: number | null };
        renderer: {
          setExportSize: (w: number, h: number) => void;
          clearExportSize: () => void;
          readPixels: () => { data: Uint8Array; w: number; h: number };
          onSeek: () => void;
        };
        renderFrame: (t: number) => void;
        exportFrames: () => Promise<Record<string, number[]>>;
      };
    }).__artmatic;

    // 挂起预览 rAF 的渲染权（与 Transport 的导出路径同一个闸门），
    // 否则后台 tick 会在两条序列之间乱泵反馈历史。
    A.appState.exportProgress = 0;
    try {
      A.store.setDuration(0.5); // 15 帧 @30fps

      // 预览参考必须与导出走完全相同的历史路径：
      // 清反馈 → 从第 0 帧顺序渲到第 7 帧（单帧无历史渲法与导出有历史
      // 渲法在 echo 类特效上必然不同——这是历史，不是噪声）。
      A.renderer.onSeek();
      A.renderer.setExportSize(1920, 1080);
      for (let i = 0; i <= 7; i++) A.renderFrame(i / 30);
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

      // readPixels 原点在左下，PNG/ImageData 原点在左上——跨边界比像素必须翻 Y。
      // （demo 是纯平色时这个 bug 是隐形的：翻转不变。有细节的画面才会暴露。）
      const w = ref.w;
      const h = ref.h;
      let sum = 0;
      let maxD = 0;
      for (let y = 0; y < h; y++) {
        const refRow = (h - 1 - y) * w * 4;
        const imgRow = y * w * 4;
        for (let x = 0; x < w * 4; x++) {
          const d = Math.abs(img[imgRow + x]! - ref.data[refRow + x]!);
          sum += d;
          if (d > maxD) maxD = d;
        }
      }
      const n = w * h * 4;
      return {
        count: names.length,
        first: names[0],
        sameSize: img.length === ref.data.length,
        mean: sum / n,
        max: maxD,
      };
    } finally {
      A.appState.exportProgress = null;
    }
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
  await openDemo(page);
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { setDuration: (s: number) => void } };
    }).__artmatic;
    A.store.setDuration(0.2); // 6 帧，跑快点
  });

  // 导出入口在窄侧栏的「导出」面板里（工程级动作，与保存同类；工具条只放
  // 逐帧/逐拍的操作——见 AGENTS.md §6.7 的操作分工）。所以要先开面板。
  await page.getByTestId('rail-export').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-png').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const path = await download.path();
  const zip = unzipSync(new Uint8Array(await readFile(path!)));
  expect(Object.keys(zip).filter((n) => n.endsWith('.png'))).toHaveLength(6);
});
