import { expect, test, type Page } from '@playwright/test';
import { NOISE_MODE_CLICKS, NOISE_MODE_STRESS } from '../../src/ui/mascot/squeak-plan';

/**
 * 看板娘（彩蛋）的端到端回归。
 *
 * 需求给的四条硬约束，各有一条防线，且都不在别处：
 *
 *  1. **落在 `.stage` 的右下角、且不挡「添加轨道」** —— 直接断「她与那两个
 *     按钮的矩形不相交」。左下角那版就是挡在这儿被退回来的。
 *  2. **位置跟着检查器的宽度让开** —— 不是断言某个固定像素，而是关掉抽屉再看
 *     她的右边界是否跟着 `.stage` 的右边界走（`.stage` 的右边 == 抽屉的左边）。
 *  3. **不捏的时候不许动** —— 断「她身上没有任何动画」。常驻呼吸曾经干扰视线，
 *     任何形式的回潮都会让这条变红。
 *  4. **悬停时往右下方躲一下，且躲完不出界** —— 断位移方向 + 躲完仍完整落在
 *     `.stage` 内（底边留白取成大于位移就是为了这个）。
 *
 * 另外两条是渲染层的事，各自有独立签名：
 *  · 挤压回弹（`anim.pause()` + `currentTime` seek 采样，与墙钟无关）；
 *  · 合成器接线（`audioState` + 连点后必须出现噪音爆）。
 */

type MascotApi = {
  appState: {
    mascotEnabled: boolean;
    setMascotEnabled: (v: boolean) => void;
    setDrawerOpen: (v: boolean) => void;
  };
  mascotStats: () => {
    squeaks: number;
    noiseBursts: number;
    stress: number;
    audioState: string;
    lastPlan: { freq: number; noiseMode: boolean; duration: number } | null;
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

/**
 * 走真实的设置面板把看板娘打开。
 *
 * 刻意不直接调 setter：这条路径要证明的是「外观分页里那个复选框真的接到了
 * 草稿模型、并且 Apply 真的落地」—— 直接调 setter 会把这一段完全跳过去。
 */
async function enableViaSettings(page: Page): Promise<void> {
  await page.getByTestId('rail-settings').click();
  await page.getByTestId('settings-nav-appearance').click();
  await page.getByTestId('settings-mascot').click();
  // 草稿态：标签前应当亮起「本次已更改」的星号
  await expect(page.getByTestId('settings-pane-appearance').locator('.star')).toHaveCount(1);
  await page.getByTestId('settings-apply').click();
  await expect(page.getByTestId('modal-settings')).toHaveCount(0);
}

/** 读取捏响的合成器读数。 */
function stats(page: Page) {
  return page.evaluate(() =>
    (window as never as { __artmatic: MascotApi }).__artmatic.mascotStats(),
  );
}

/** 布局基准：这些盒子的几何在开关看板娘前后必须一模一样。 */
function layoutProbe(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const pick: [string, string][] = [
      ['page', '.page'],
      ['stage', '.stage'],
      ['preview', '.preview'],
      ['canvas', '#gl'],
      ['toolbar', '.toolbar'],
      ['tracks', '.tracks'],
      ['addVisual', '[data-testid=add-visual-track]'],
      ['drawer', '[data-testid=drawer]'],
      ['statusbar', '.statusbar'],
    ];
    const out: Record<string, string> = {};
    for (const [name, sel] of pick) {
      const el = document.querySelector(sel);
      if (!el) {
        out[name] = 'missing';
        continue;
      }
      const r = el.getBoundingClientRect();
      out[name] = [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',');
    }
    return out;
  });
}

test('默认不开；开着时落在 .stage 右下角、不挡添加轨道、也不动任何布局', async ({ page }) => {
  await boot(page);

  // 默认关：彩蛋不该未经同意就住进用户的界面里。
  await expect(page.getByTestId('mascot')).toHaveCount(0);

  const before = await layoutProbe(page);
  await enableViaSettings(page);
  await expect(page.getByTestId('mascot')).toBeVisible();
  expect(await layoutProbe(page), '开关看板娘不能改动任何控件的几何').toEqual(before);

  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-testid=mascot]')!;
    const stage = document.querySelector('.stage')!;
    const a = el.getBoundingClientRect();
    const b = stage.getBoundingClientRect();
    return {
      inStage: el.closest('.stage') !== null,
      dRight: Math.round(b.right - a.right),
      dBottom: Math.round(b.bottom - a.bottom),
      w: Math.round(a.width),
      h: Math.round(a.height),
    };
  });
  // 宿主是 .stage（不是 .page）：她的右边就只能落在检查器的左边，中间不需要 calc
  expect(box.inStage, '看板娘的宿主应当是 div.stage').toBe(true);
  expect(box.dRight, '与右下角留的余量（够躲一下）').toBeGreaterThanOrEqual(0);
  expect(box.dRight).toBeLessThan(16);
  expect(box.dBottom).toBeGreaterThanOrEqual(0);
  expect(box.dBottom).toBeLessThan(16);
  expect(box.w).toBeGreaterThan(40);
  expect(box.h).toBeGreaterThan(40);

  /*
   * 左下角那版就是挡在「添加轨道」上被退回来的 —— 这条是那次退回来的直接原因，
   * 所以断「矩形不相交」，而不是断「她不在左边」。
   */
  const clash = await page.evaluate(() => {
    const a = document.querySelector('[data-testid=mascot]')!.getBoundingClientRect();
    const hit: string[] = [];
    for (const id of ['add-visual-track', 'add-audio-track']) {
      const b = document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect();
      if (!b) continue;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hit.push(id);
    }
    return hit;
  });
  expect(clash, '看板娘不能压在「添加轨道」上').toEqual([]);

  // 落点处真正被点到的必须是她（不是画在她上面的什么东西）
  const hit = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid=mascot]')!;
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at ? el.contains(at) : false;
  });
  expect(hit, '看板娘中心点必须命中她自己').toBe(true);

  // 关掉就立刻消失（同一个复选框再来一次）
  await page.getByTestId('rail-settings').click();
  await page.getByTestId('settings-nav-appearance').click();
  await page.getByTestId('settings-mascot').click();
  await page.getByTestId('settings-apply').click();
  await expect(page.getByTestId('mascot')).toHaveCount(0);
  expect(await layoutProbe(page)).toEqual(before);
});

test('位置跟着检查器的宽度让开：关掉抽屉她就跟着往右挪', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    (window as never as { __artmatic: MascotApi }).__artmatic.appState.setMascotEnabled(true),
  );
  await expect(page.getByTestId('mascot')).toBeVisible();

  /** 她的右边界 vs `.stage` 的右边界 vs 抽屉的左边界。 */
  const probe = (): Promise<{ gap: number; stageRight: number; drawerLeft: number | null }> =>
    page.evaluate(() => {
      const a = document.querySelector('[data-testid=mascot]')!.getBoundingClientRect();
      const s = document.querySelector('.stage')!.getBoundingClientRect();
      const d = document.querySelector('[data-testid=drawer]');
      return {
        gap: Math.round(s.right - a.right),
        stageRight: s.right,
        drawerLeft: d ? d.getBoundingClientRect().left : null,
      };
    });

  const open = await probe();
  expect(open.drawerLeft, '默认应当是抽屉展开的').not.toBeNull();
  // `.stage` 的右边就是抽屉的左边 —— 她就是靠这一条自动「按检查器宽度让开」的
  expect(Math.abs(open.stageRight - open.drawerLeft!), 'stage 右边应贴住抽屉左边').toBeLessThan(2);
  // 与右下角的余量固定，不随抽屉宽度变
  const gap = open.gap;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(16);

  await page.evaluate(() =>
    (window as never as { __artmatic: MascotApi }).__artmatic.appState.setDrawerOpen(false),
  );
  await expect(page.getByTestId('drawer')).toHaveCount(0);
  const closed = await probe();
  expect(closed.stageRight - open.stageRight, '关掉抽屉后 stage 应当变宽至少一个抽屉').toBeGreaterThan(
    100,
  );
  expect(closed.gap, '留白与右下角的余量不随抽屉变（所以她跟着挪了）').toBe(gap);
});

test('不捏的时候一动不动；悬停时往右下方躲一下且不出界', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    (window as never as { __artmatic: MascotApi }).__artmatic.appState.setMascotEnabled(true),
  );
  await expect(page.getByTestId('mascot')).toBeVisible();
  // 常驻动画的旧版本会在这段时间里一直跑
  await page.waitForTimeout(800);

  /*
   * 「不捏就不要动」= 她身上没有任何动画在跑，而且内层元素没有挂 CSS 动画。
   * 只断「现在没动」是不够的 —— 一个 3 秒循环的呼吸动画会在采样那一刻看起来
   * 也是「没动」。所以两条一起断：`getAnimations()` 为空 + `animation-name: none`。
   */
  const idle = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid=mascot]')!;
    const inner = el.querySelector<HTMLElement>('[class*=inner]')!;
    return {
      anims: el.getAnimations({ subtree: true }).length,
      innerName: getComputedStyle(inner).animationName,
      // 镜像：原图朝右，站在右下角必须翻过来
      innerScaleX: new DOMMatrixReadOnly(getComputedStyle(inner).transform).a,
    };
  });
  expect(idle.anims, '闲着的时候不该有任何动画').toBe(0);
  expect(idle.innerName, '内层不该挂 CSS 动画（呼吸）').toBe('none');
  expect(idle.innerScaleX, '必须镜像（scaleX 为负）').toBeLessThan(-0.9);

  /* ---------------- 悬停：往右下躲一下 ---------------- */
  const boxOf = (): Promise<{ x: number; y: number; right: number; bottom: number }> =>
    page.evaluate(() => {
      const r = document.querySelector('[data-testid=mascot]')!.getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });

  const rest = await boxOf();
  await page.getByTestId('mascot').hover();
  await page.waitForTimeout(400); // 170ms 的过渡
  const dodged = await boxOf();
  expect(dodged.x - rest.x, '悬停应当往右躲').toBeGreaterThan(1.5);
  expect(dodged.y - rest.y, '悬停应当往下躲').toBeGreaterThan(1);

  /*
   * 躲完不能出界。底边/右边的留白故意取成大于位移量，就是为了两种抽屉状态都
   * 成立（抽屉收起时 `.stage` 的右边就是窗口右边，没有留白会被直接裁掉）。
   */
  const inside = await page.evaluate(() => {
    const a = document.querySelector('[data-testid=mascot]')!.getBoundingClientRect();
    const s = document.querySelector('.stage')!.getBoundingClientRect();
    return { dRight: s.right - a.right, dBottom: s.bottom - a.bottom };
  });
  expect(inside.dRight, '躲完仍在 stage 内（右）').toBeGreaterThanOrEqual(0);
  expect(inside.dBottom, '躲完仍在 stage 内（下）').toBeGreaterThanOrEqual(0);

  /*
   * hover 的底必须是透明的。`app.css` 的 `button:hover:not(:disabled)` 特异度
   * 高于 `.mascot:hover`，漏防的表现是悬停时浮出一块不透明底 —— 她立刻变成
   * 「贴上去的一张图」而不是从角上探出来。
   */
  const hoverBg = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-testid=mascot]')!).backgroundColor,
  );
  expect(hoverBg, '悬停不该有底色').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

test('抽屉与底栏压在看她板娘上面（她躲进去时不会被画在身上）', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    (window as never as { __artmatic: MascotApi }).__artmatic.appState.setMascotEnabled(true),
  );
  await expect(page.getByTestId('mascot')).toBeVisible();

  /*
   * 平时她与抽屉/底栏并不重叠，所以「谁在上面」用 `elementFromPoint` 是测不到的。
   * 这里把她**临时**推到两个区域底下（只改这一条用例里的内联样式），再看命中
   * 结果 —— 这是唯一能真正验证层叠顺序、而不是只比数字的办法。
   */
  const hitBelow = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid=mascot]')!;
    const stage = document.querySelector('.stage')!.getBoundingClientRect();
    const drawer = document.querySelector<HTMLElement>('[data-testid=drawer]')!;
    const bar = document.querySelector<HTMLElement>('.statusbar')!;
    el.style.width = '220px';
    el.style.height = '220px';
    el.style.right = '-60px';
    el.style.bottom = '-40px';

    const hitAt = (x: number, y: number): Element | null => document.elementFromPoint(x, y);
    // 一个点同时落在「她」与「抽屉」里
    const inDrawer = hitAt(stage.right + 30, stage.bottom - 10);
    // 一个点同时落在「她」与「底栏」里
    const inBar = hitAt(stage.right - 40, bar.getBoundingClientRect().top + 8);
    return {
      drawerHit: inDrawer ? drawer.contains(inDrawer) || inDrawer === drawer : false,
      drawerIsMascot: inDrawer ? el.contains(inDrawer) : false,
      barHit: inBar ? bar.contains(inBar) || inBar === bar : false,
      barIsMascot: inBar ? el.contains(inBar) : false,
    };
  });
  expect(hitBelow.drawerIsMascot, '被推到抽屉底下时不该还能点到她').toBe(false);
  expect(hitBelow.drawerHit, '抽屉必须盖住看板娘').toBe(true);
  expect(hitBelow.barIsMascot, '被推到底栏底下时不该还能点到她').toBe(false);
  expect(hitBelow.barHit, '底栏必须盖住看板娘').toBe(true);
});

test('捏一下：先压扁再回弹，并且接到了合成器上；连点会变噪音', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    (window as never as { __artmatic: MascotApi }).__artmatic.appState.setMascotEnabled(true),
  );
  await expect(page.getByTestId('mascot')).toBeVisible();

  /* ---------------- 声音：真实鼠标事件 ----------------
   * 用 `force: true` 绕过 Playwright 的命中检查（气泡可能悬在她上方遮住命中点），
   * 但底层仍是**真实输入事件** —— 合成事件拿不到用户手势，AudioContext 起不来，
   * 那这条用例就退化成「只是数字 +1」了。命中正确性上面已经单独断过。
   */
  await page.getByTestId('mascot').click({ force: true });
  const one = await stats(page);
  expect(one.squeaks).toBe(1);
  expect(one.noiseBursts).toBe(0);
  expect(one.lastPlan, '应当留下一份完整的合成计划').toBeTruthy();
  expect(one.lastPlan!.noiseMode, '单次点击不该是噪音').toBe(false);
  expect(one.audioState, 'AudioContext 必须真的建起来（没有 Web Audio 就是 none）').not.toBe(
    'none',
  );

  /* ---------------- 动画：暂停后按进度 seek ----------------
   *
   * ⚠️ **不要靠墙钟采样。** 第一版是「点一下然后连等 45 个 rAF」，实测这是
   * **假红**：headless 里点击之后的第一个 rAF 可以迟到 ~340ms（浏览器没有帧要
   * 提交时不会提前把动画的 startTime 定下来），于是 45 帧跑完时动画才走到
   * 「压扁」那一段，回弹根本还没发生 —— 断言「要回弹过头」必挂，而代码是对的。
   *
   * 改成**暂停动画、按进度 seek**：`currentTime` 一设，getComputedStyle 立刻
   * 给出该点的插值，与真实时间无关。再把「点击那一刻动画在跑」单独断掉，
   * 否则这段就退化成「只验证 keyframes 写对了」。
   */
  const squash = await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('[data-testid=mascot]')!;
    const img = btn.querySelector('img')!;
    btn.click();
    const anim = img.getAnimations()[0];
    const out = { found: false, dur: 0, playState: '', minY: 1, maxY: 1, minX: 1, maxX: 1 };
    if (!anim) return out;
    out.found = true;
    out.dur = Number(anim.effect?.getTiming().duration ?? 0);
    out.playState = anim.playState;
    anim.pause();
    out.minY = Infinity;
    out.maxY = -Infinity;
    out.minX = Infinity;
    out.maxX = -Infinity;
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      anim.currentTime = (out.dur * i) / steps;
      const t = getComputedStyle(img).transform;
      if (!t || t === 'none') continue;
      const m = new DOMMatrixReadOnly(t);
      out.minY = Math.min(out.minY, m.d);
      out.maxY = Math.max(out.maxY, m.d);
      out.minX = Math.min(out.minX, m.a);
      out.maxX = Math.max(out.maxX, m.a);
    }
    anim.cancel();
    return out;
  });

  expect(squash.found, '点一下必须产生一个动画').toBe(true);
  expect(squash.playState, '点击那一刻动画应当正在跑（不是建好就停）').toBe('running');
  expect(squash.dur).toBeGreaterThan(200);

  /*
   * 判据必须**只被「过冲」满足**，否则就是一条永远绿的假防线。
   *
   * 第一版写的是 `maxY > 1.005` —— 它被 offset 0.72 那个关键帧自己的
   * `scaleY = 1.06` 满足了：把回弹段的 easing 换成不过冲的 `ease-out`，
   * 用例照样通过（实测）。所以真正的判据是「**越过了所有关键帧的极值**」：
   *   · scaleY 的最大值是 1.06（关键帧），过冲把它推到 ~1.093；
   *   · scaleX 的最小值是 0.96（关键帧），过冲把它压到 ~0.938。
   * 两侧各一条，互为独立签名。镜像挂在**外层 span** 上，所以 `img` 自己的
   * scaleX 仍是正的 —— 这里不需要取绝对值。
   */
  expect(squash.minY, '要变矮过：scaleY 压到关键帧的 0.84 一带').toBeLessThan(0.86);
  expect(squash.maxX, '压扁要横向铺开：scaleX 顶到关键帧的 1.1 一带').toBeGreaterThan(1.09);
  expect(squash.maxY, '回弹要**越过**关键帧的极值 1.06（这才是过冲）').toBeGreaterThan(1.07);
  expect(squash.maxY, '但不该弹到失控').toBeLessThan(1.2);
  expect(squash.minX, '回弹的过冲也会让 scaleX 跌破关键帧的 0.96').toBeLessThan(0.95);

  /* ---------------- 连点 → 噪音 ----------------
   * 上面那次合成点击也计进了窗口，所以用**增量**而不是绝对值断言：
   * 计数口径变了不该让这条用例挂，但「点够了就变噪音」必须成立。
   */
  const before = await stats(page);
  for (let i = 0; i < NOISE_MODE_CLICKS; i += 1) {
    await page.getByTestId('mascot').click({ force: true });
  }
  const many = await stats(page);
  expect(many.squeaks - before.squeaks).toBe(NOISE_MODE_CLICKS);
  expect(many.noiseBursts, '连点必须出现噪音爆').toBeGreaterThanOrEqual(1);
  expect(many.stress).toBeGreaterThanOrEqual(NOISE_MODE_STRESS);
  expect(many.lastPlan!.noiseMode).toBe(true);
});
