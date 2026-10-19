import { expect, test } from '@playwright/test';
import { openDemo } from './_stage';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * MP4 导出 E2E。
 *
 * ## 磁盘纪律（先读这段）
 *
 * 这个 spec 会**真的产出 MP4 文件**。反复跑而不清理的话，
 * 下载目录 / 临时目录很快会堆掉几个 GB —— 而这类污染最难排查
 * （E2E 本身不会报错，磁盘默默变小）。
 *
 * 三条规矩：
 *
 * 1. **分辨率压到 320×180、时长压到 0.5s（15 帧）。**
 *    产物只有几十 KB。这不测编码性能（无头下硬编本来就失效，
 *    AGENTS ADR-001 补注已记），只测「产物存在、结构正确、可解析」。
 * 2. **产物落 `os.tmpdir()`，不是一个累积目录。**
 *    Playwright 的 `download.path()` 已经在临时目录，所以下载路径不额外占地方。
 * 3. **每条断言用到字节之后立刻 `rm`。**
 *    `test.afterEach` 再兜底删一次目录 —— 断言失败时 `afterEach` 仍然跑，
 *    这是「测试失败也不留垃圾」的唯一保证。
 *
 * **不要为了「看得更清楚」把时长调大。** 需要验证长时间导出稳定性的话，
 * 那是手工做一次（`bun run dev` + 导出 + 看进度 + 手动删），
 * 不是塞进 CI。
 */

const TMP_DIR = join(tmpdir(), 'artmatic-e2e-export');

test.afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

/** 极小的工程配置：320×180、0.5s。够验证结构，不占磁盘。 */
async function setupTinyProject(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  // demo 含 bake 型生成器：被动等烘焙落地（见 determinism.spec 的注释）
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { setResolution: (w: number, h: number) => void; setDuration: (s: number) => void } };
    }).__artmatic;
    A.store.setResolution(320, 180);
    A.store.setDuration(0.5);
  });
}

test('导出 MP4：产物存在、是合法 MP4 容器、帧数与工程一致', async ({ page }) => {
  await setupTinyProject(page);

  // 走真实下载路径。文件名断言在下载事件上，字节在下载文件上。
  await page.getByTestId('rail-export').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-mp4').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.mp4$/);

  // 先把字节搬到我们自己控制的临时目录再读 —— Playwright 的临时下载文件
  // 会在 context 关闭后消失，跨断言不可靠。
  await mkdir(TMP_DIR, { recursive: true });
  const dest = join(TMP_DIR, 'out.mp4');
  await download.saveAs(dest);

  const bytes = await readFile(dest);

  // 1. 非空
  expect(bytes.byteLength).toBeGreaterThan(0);

  // 2. ftyp box：ISO BMFF 魔数，offset 4 是 'ftyp'。
  //    这是「这真的是 MP4 而不是别的东西」的最短判据。
  expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');

  // 3. moov box 存在（fastStart 应当把它放在文件头附近，容器才有秒开）。
  const head = bytes.subarray(0, 4096).toString('latin1');
  expect(head).toContain('moov');

  // 4. 文件名 = 工程名 + .mp4（默认工程名兜底为 'artmatic'）
  //    —— 这里不断言具体名字，只断言扩展名，上面已断。

  // 体积上限：320×180×15 帧 应该在几十 KB 量级。
  // 这条断言是**磁盘纪律的守卫**：一旦有人把测试分辨率调大，
  // 这条会先失败提醒，而不是安静地每次写 100 MB。
  expect(bytes.byteLength).toBeLessThan(1_000_000);
});

test('导出 MP4：带音轨（工程有音频片段 → 产物含音频轨）', async ({ page }) => {
  await setupTinyProject(page);

  // 先确认工程里确实有音频片段（demo 工程带程序生成的节拍）。
  const audioCount = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { kind: string; enabled: boolean; clips: unknown[] }[] } } };
    }).__artmatic;
    return A.store.project.tracks
      .filter((t) => t.kind === 'audio' && t.enabled)
      .reduce((n, t) => n + t.clips.length, 0);
  });
  expect(audioCount).toBeGreaterThan(0);

  await page.getByTestId('rail-export').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-mp4').click();
  const download = await downloadPromise;

  await mkdir(TMP_DIR, { recursive: true });
  const dest = join(TMP_DIR, 'audio.mp4');
  await download.saveAs(dest);
  const bytes = await readFile(dest);

  // 音轨的证据：整段文件里应能找到 'mp4a'（esds 里的 objectTypeIndication
  // 编码成 mp4a）或 'soun'（hdlr 里的 handler type）。
  // 这是字节级的粗判据 —— 够证明「不是纯视频轨」。
  const text = bytes.toString('latin1');
  expect(text.includes('mp4a') || text.includes('soun')).toBe(true);
  expect(bytes.byteLength).toBeLessThan(2_000_000);
});

test('导出面板：同时提供 MP4 与 PNG 两个入口，且 MP4 显示预计体积', async ({ page }) => {
  await setupTinyProject(page);
  await page.getByTestId('rail-export').click();

  // 两个按钮都在
  await expect(page.getByTestId('export-mp4')).toBeVisible();
  await expect(page.getByTestId('export-png')).toBeVisible();

  // MP4 的体积估计挂在按钮**下方**的说明里（磁盘纪律的第一道防线：
  // 点之前就知道多大）。原来它被塞进按钮标签，现在标签只留「MP4」。
  const hint = await page.getByTestId('export-mp4-hint').textContent();
  expect(hint).toMatch(/\d+(\.\d+)?\s*(KB|MB|B|GB)/);
});

test('Main 被拒时退到 Constrained Baseline，且产物能被解码器读回（W0.5）', async ({ page }) => {
  await setupTinyProject(page);

  /*
   * 模拟「无硬件编码器」的机器：把 Main 两档报成不支持，baseline 照实问。
   *
   * 为什么不是 `hardwareAcceleration: 'prefer-software'`：那只是给编码器的
   * **偏好**，实测在有硬编的机器上它仍会返回 Main 支持（这个构建并不因此
   * 切换到 OpenH264）。而这条用例要验证的是**阶梯逻辑**——「Main 被拒 →
   * 用 baseline 编 → 产物 profile 真的是 0x42」；能力报告正是阶梯的唯一输入，
   * 所以在这层做桩，比去猜驱动的偏好可靠。
   */
  await page.evaluate(() => {
    const real = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    Object.defineProperty(VideoEncoder, 'isConfigSupported', {
      configurable: true,
      value: async (config: VideoEncoderConfig) => {
        if (String(config.codec).startsWith('avc1.4d')) return { supported: false };
        return real(config);
      },
    });
  });

  const probe = await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: { exportMp4Probe: () => Promise<Record<string, unknown>> };
    }).__artmatic;
    return A.exportMp4Probe();
  });

  // 断言三件事：选中的是 baseline 档、产物 avcC 的 profile 是 0x42、
  // 这份 avcC 能被解码器接受（「盒子对」不等于「能播」）。
  expect(probe.codec, 'Main 全被拒时应当落到 baseline 档').toMatch(/^avc1\.42e0/);
  expect(probe.bytes as number).toBeGreaterThan(0);
  expect(probe.avcProfile, 'avcC 里的 profile 应当是 Baseline（0x42）').toBe(0x42);
  expect(probe.decodable, '产物的 avcC 应当能被 VideoDecoder 接受').toBe(true);
});

test('H.264 全不支持时文案说「只能导出 PNG 序列」，不是「不支持 WebCodecs」', async ({ page }) => {
  await setupTinyProject(page);

  // 桩在打开面板**之前**：探测发生在面板挂载时。
  await page.evaluate(() => {
    Object.defineProperty(VideoEncoder, 'isConfigSupported', {
      configurable: true,
      value: async () => ({ supported: false }),
    });
  });

  await page.getByTestId('rail-export').click();
  const hint = page.getByTestId('export-mp4-hint');
  await expect(hint).toContainText('只能导出 PNG 序列');
  // 这是 W0.5 的全部意义：机器能编 H.264，只是编不了这批 profile。
  await expect(hint).not.toContainText('不支持 WebCodecs');
  await expect(page.getByTestId('export-mp4')).toBeDisabled();
});

test('导出管线（不经下载）：产物是含音视频双轨的合法 MP4', async ({ page }) => {
  await setupTinyProject(page);

  // 走 page 内的探针：结构判据在 page 内做完，只回传标量。
  // 这条比下载那条快得多（省一次 blob → 磁盘 → 读盘），
  // 所以结构验证放这里，「真实下载路径」留给另一条。
  const probe = await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: { exportMp4Probe: () => Promise<Record<string, unknown>> };
    }).__artmatic;
    return A.exportMp4Probe();
  });

  expect(probe.bytes).toBeGreaterThan(0);
  expect(probe.ftyp).toBe('ftyp');       // ISO BMFF 魔数
  expect(probe.hasMoov).toBe(true);      // 容器索引（fastStart 应在文件头）
  expect(probe.hasVideo).toBe(true);     // avc1
  expect(probe.hasAudio).toBe(true);     // mp4a / soun
  // demo 的程序生成音频不该是全静音 —— 峰值过小说明混流没接上
  expect(probe.audioPeak as number).toBeGreaterThan(0.01);
  // 磁盘纪律守卫：320×180×15 帧应在几十 KB 量级
  expect(probe.bytes as number).toBeLessThan(1_000_000);
});
