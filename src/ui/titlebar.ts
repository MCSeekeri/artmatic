/**
 * titlebar.ts — 桌面壳的窗口顶栏接线。**浏览器里整段是空操作。**
 *
 * 壳关掉了原生菜单、`titleBarStyle` 设成 `hidden`，于是窗口最上面那一条就是应用
 * 自己的 `.topbar`（Web 版本来就是这样，桌面版只是把系统那层贴上去）。这带来两件
 * 渲染层必须做的事：
 *
 * 1. **给系统画的窗口按钮让位**。那块（最小化 / 最大化 / 关闭）的宽度随 DPI 与
 *    窗口状态变，写死 px 必然错位；准数只有 `navigator.windowControlsOverlay`
 *    给得出。让出来的量写到 `--wco-w`，由 TopBar 的样式吃。
 * 2. **窗口按钮的配色跟随主题**。它由主进程画，读不到 CSS 变量 —— 主题一变就得
 *    把算好的颜色发过去，否则深色主题里会挂着三个浅底方块。
 *
 * 两件事都以「WCO 真的可用」为前提：不可用时（浏览器、macOS、窗口最大化前的
 * 某些状态）`data-wco` 不出现，TopBar 里那几条拖拽规则也就不生效 —— 顶栏保持
 * 普通的可选中区域。**不要**无条件给顶栏加 `-webkit-app-region: drag`：在浏览器里
 * 那等于把顶栏变成「点不到、选不中」的死区。
 */

import { platform } from '../platform/index';

/** 顶栏高度。`--topbar-h` 是唯一真源（tokens.ts 的 `DENSITY.topbarH`）。 */
function titleBarHeight(): number {
  const px = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'),
  );
  return Number.isFinite(px) && px > 0 ? px : 30;
}

/**
 * 读一个颜色 token。
 *
 * component 层 token 的值是 `var(--surface-1)` 这种**未展开**的形态（见
 * `tokens.ts::resolveTokens` 的说明），所以这里要解开一层 —— 直接把
 * `var(--x)` 交给 Electron 会让 `setTitleBarOverlay` 抛。
 */
function colorToken(name: string): string {
  const cs = getComputedStyle(document.documentElement);
  const raw = cs.getPropertyValue(name).trim();
  const nested = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw);
  return nested ? cs.getPropertyValue(nested[1]!).trim() : raw;
}

/** Electron 只认 hex；拿不到合法值就不发（保留上一版配色，总比抛错好）。 */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** 主题变更后调一次：把窗口按钮的底色 / 符号色 / 高度推给主进程。 */
export function syncTitleBarOverlay(): void {
  const shell = platform.shell;
  if (!shell) return;
  const color = colorToken('--bar-bg');
  const symbolColor = colorToken('--bar-fg');
  if (!HEX.test(color) || !HEX.test(symbolColor)) return;
  shell.setTitleBarOverlay({ color, symbolColor, height: titleBarHeight() });
}

/**
 * 窗口控件接口。Electron 实现了 `navigator.windowControlsOverlay`，但
 * TS 的 lib.dom 里没有它 —— 这里按规范声明最小形状，不引第三方类型。
 */
interface ControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

/** 挂载窗口顶栏的几何。**在 mount 之前调**（晚一帧顶栏就不能拖）。 */
export function installWindowChrome(): void {
  if (!platform.shell) return;
  const wco = (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay })
    .windowControlsOverlay;
  if (!wco) return;

  const root = document.documentElement;
  const apply = (): void => {
    /*
     * `getTitlebarAreaRect()` 给的是**可拖拽区**（不含按钮），所以右侧要让开的
     * 量 = 窗口宽 − rect.width。不要反过来用它算左边：macOS 的按钮在左，
     * 而那边根本走不到这里。
     */
    const rect = wco.getTitlebarAreaRect();
    const inset = Math.max(0, Math.round(window.innerWidth - rect.width));
    root.style.setProperty('--wco-w', `${inset}px`);
    root.dataset.wco = wco.visible ? 'on' : 'off';
    // 全屏 / 隐藏时按钮不在，颜色也不用发。
    if (wco.visible) syncTitleBarOverlay();
  };

  apply();
  // 最大化 / 还原 / 窗口宽度变化都会改按钮的占位，两个都听。
  wco.addEventListener('geometrychange', apply);
  window.addEventListener('resize', apply);
}
