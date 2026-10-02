import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CSS 命名空间守卫。
 *
 * `src/app.css` 与 `src/ui/controls/controls.css` 是**全局**样式表（main.ts 直接
 * import）。Svelte 组件的 `<style>` 是 scoped 的，所以组件自己的规则不会外泄 ——
 * 但反过来成立：**组件里用的类名会被全局规则命中**。
 *
 * 踩过的真事：排版画布的选中框用了 `class="sel"`，而 `controls.css` 里 `.sel` 是
 * Select 控件的类名（`background: var(--input-bg)` + 1px 边框）。我的 scoped 规则
 * 只声明了 `outline`，背景没被覆盖，于是**选中框变成一个不透明白块，把图形整个盖住**。
 * 同样的问题还有 `.swatch`（Ribbon 色块 ↔ 全局 swatch）。
 *
 * 这类 bug 肉眼要等到某个元素正好被选中才出现，控制台没有任何提示。所以在这里
 * 用一条测试钉死：排版/Ribbon 组件里不许出现全局类名。
 */

const ROOT = process.cwd();
const GLOBAL_CSS = ['src/app.css', 'src/ui/controls/controls.css'];
/** 只扫新写的这两块；controls/ 自己就是全局类的**定义方**，不适用。 */
const SCANNED_DIRS = ['src/ui/typography', 'src/ui/ribbon'];

function globalClassNames(): Set<string> {
  const out = new Set<string>();
  for (const rel of GLOBAL_CSS) {
    const css = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)/g)) out.add(m[1]!);
  }
  return out;
}

function collectSvelte(dir: string): string[] {
  const abs = join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const p = join(abs, entry);
    if (statSync(p).isDirectory()) out.push(...collectSvelte(join(dir, entry)));
    else if (entry.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/** 文件里实际写进 `class=` / `class:xxx` 的类名。 */
function usedClassNames(file: string): Set<string> {
  // 先把 `{表达式}` 挖掉：`class="handle {h}"` 里的 `{h}` 是动态朝向类，
  // 不属于静态命名，挖掉之后仍然能捕到 `handle`。
  const src = readFileSync(file, 'utf8').replace(/\{[^{}]*\}/g, ' ');
  const names = new Set<string>();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const n of m[1]!.trim().split(/\s+/)) if (n) names.add(n);
  }
  for (const m of src.matchAll(/class:([a-z][a-z0-9-]*)/g)) names.add(m[1]!);
  return names;
}

describe('CSS 命名空间', () => {
  it('全局样式表能解析出类名（守住这个测试本身的有效性）', () => {
    const globals = globalClassNames();
    // 抽查几个已知的全局类，防止正则写歪之后「全绿」变成假绿
    expect(globals.has('sel')).toBe(true);
    expect(globals.has('swatch')).toBe(true);
    expect(globals.has('btn')).toBe(true);
    expect(globals.has('menu-item')).toBe(true);
    expect(globals.size).toBeGreaterThan(20);
  });

  it('排版 / Ribbon 组件不使用任何全局类名', () => {
    const globals = globalClassNames();
    const clashes: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of collectSvelte(dir)) {
        for (const name of usedClassNames(file)) {
          if (globals.has(name)) clashes.push(`${file.replace(ROOT, '').replace(/\\/g, '/')} → .${name}`);
        }
      }
    }
    expect(
      clashes,
      '这些类名与全局样式表撞车，会继承到不该有的背景/边框。加前缀改名（如 .sel → .typo-sel）。',
    ).toEqual([]);
  });

  it('扫描器确实能读到类名（否则上一条是空断言）', () => {
    const all = collectSvelte(SCANNED_DIRS[0]!).flatMap((f) => [...usedClassNames(f)]);
    expect(all).toContain('typo-sel'); // TypographyEditor 的选中框
    expect(all.length).toBeGreaterThan(10);
  });
});
