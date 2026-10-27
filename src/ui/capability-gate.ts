/**
 * capability-gate.ts — 启动能力闸门（可选）。
 *
 * 只查两件事，而且都是**没有它就没法工作**的硬能力：
 *  · `showDirectoryPicker` —— 没有它，工程只能活在内存里，保存会静默失败；
 *  · WebGL2 —— 没有它，预览与导出都是一张空白。
 *
 * 缺任一项就在 `#app` 里渲染一段静态说明，**不加载主应用**。这正是为了避开
 * 那种最糟的形态：界面看起来正常、也能点，但保存与渲染全都不工作 —— 用户会
 * 先以为是自己操作错了。
 *
 * 桌面壳落地后这个闸门可以删；在那之前它让 Web 版不至于假装能用。
 * 这里刻意**不 import** `appState` / 组件 / 渲染层：能力不够的浏览器不该为
 * 它们付一次下载与解析。
 */

import { tr } from '../i18n/index.svelte';

export type CapabilityGap = 'no-webgl2' | 'no-dir-picker';

/** 当前环境缺哪一项；null = 两项都在。 */
export function detectCapabilityGap(): CapabilityGap | null {
  if (typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
    return 'no-dir-picker';
  }
  const probe = document.createElement('canvas');
  try {
    if (!probe.getContext('webgl2')) return 'no-webgl2';
  } catch {
    // 某些环境（禁用硬件加速 + 黑名单）取上下文会直接抛。
    return 'no-webgl2';
  }
  return null;
}

const BOX_STYLE = [
  'max-width: 520px',
  'margin: 18vh auto 0',
  'padding: 24px 28px',
  'border: 1px solid #2c2c33',
  'border-radius: 10px',
  'background: #17171b',
  'color: #e8e8ec',
  'font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif',
].join(';');

/**
 * 画出说明。全部走 `textContent`（不拼 HTML）：这段代码要在「浏览器可能很旧」
 * 的前提下运行，`innerHTML` 在这里没有任何好处。
 */
export function renderCapabilityNotice(gap: CapabilityGap): void {
  const host = document.getElementById('app');
  if (!host) return;
  host.textContent = '';
  host.dataset.capabilityGap = gap;

  const box = document.createElement('div');
  box.style.cssText = BOX_STYLE;

  const title = document.createElement('h1');
  title.textContent = tr('app.capabilityGate.title');
  title.style.cssText = 'margin: 0 0 12px; font-size: 18px; font-weight: 600';

  const body = document.createElement('p');
  body.textContent = tr(
    gap === 'no-webgl2' ? 'app.capabilityGate.noWebgl2' : 'app.capabilityGate.noDirPicker',
  );
  body.style.margin = '0 0 10px';

  const hint = document.createElement('p');
  hint.textContent = tr('app.capabilityGate.hint');
  hint.style.cssText = 'margin: 0; color: #9a9aa4; font-size: 12px';

  box.append(title, body, hint);
  host.append(box);
}
