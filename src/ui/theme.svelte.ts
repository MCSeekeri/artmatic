/**
 * theme.svelte.ts — 主题运行时态（runes）+ 持久化。
 *
 * 主题是纯 UI 状态，放 localStorage 合规：AGENTS §1.7 要求「工程真相只在磁盘」，
 * 而主题偏好跟工程内容无关，丢了也只是回到默认值，属于可丢弃的一类。
 *
 * 默认 **亮色**。
 */

import {
  ACCENT_PRESETS,
  BRAND_IDS,
  accentRampOf,
  type AccentSource,
  type AccentRamp,
  type BrandId,
  type ThemeMode,
  type ThemeSpec,
} from './tokens';
import { tr } from '../i18n/index.svelte';

const STORAGE_KEY = 'artmatic.theme';

interface Persisted {
  mode: ThemeMode;
  accent: AccentSource;
}

function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v.trim());
}

function normalizeAccent(raw: unknown): AccentSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as { kind?: unknown; id?: unknown; hex?: unknown };
  if (a.kind === 'preset' && BRAND_IDS.includes(a.id as BrandId)) {
    return { kind: 'preset', id: a.id as BrandId };
  }
  if (a.kind === 'custom' && isHex(a.hex)) {
    return { kind: 'custom', hex: String(a.hex).trim() };
  }
  return null;
}

function load(): Persisted {
  const fallback: Persisted = { mode: 'light', accent: { kind: 'preset', id: 'violet' } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { mode?: unknown; accent?: unknown };
    return {
      mode: parsed.mode === 'dark' ? 'dark' : 'light',
      accent: normalizeAccent(parsed.accent) ?? fallback.accent,
    };
  } catch {
    // 隐私模式 / 配额满 / JSON 损坏：都不该让应用起不来。
    return fallback;
  }
}

class ThemeState {
  mode = $state<ThemeMode>('light');
  accent = $state<AccentSource>({ kind: 'preset', id: 'violet' });

  constructor() {
    const p = load();
    this.mode = p.mode;
    this.accent = p.accent;
  }

  /** 给 installTheme / canvasPalette 用。每次返回新对象，供 $effect 判等传播。 */
  get spec(): ThemeSpec {
    return { mode: this.mode, accent: this.accent };
  }

  /** 当前生效的色阶（设置面板画色块用）。 */
  get ramp(): AccentRamp {
    return accentRampOf(this.accent, this.mode);
  }

  /** 当前品牌的展示名。自定义色时直接显示 hex（它本身就是给人看的）。 */
  get accentLabel(): string {
    const a = this.accent;
    if (a.kind === 'preset') return tr(ACCENT_PRESETS[a.id].labelKey);
    return a.hex;
  }

  get isCustom(): boolean {
    return this.accent.kind === 'custom';
  }

  setMode(mode: ThemeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.persist();
  }

  toggleMode(): void {
    this.setMode(this.mode === 'light' ? 'dark' : 'light');
  }

  setPreset(id: BrandId): void {
    this.accent = { kind: 'preset', id };
    this.persist();
  }

  /** 传非法 hex 会被静默忽略，不进入一个渲染不出来的状态。 */
  setCustomAccent(hex: string): void {
    if (!isHex(hex)) return;
    const normalized = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
    this.accent = { kind: 'custom', hex: normalized };
    this.persist();
  }

  reset(): void {
    this.mode = 'light';
    this.accent = { kind: 'preset', id: 'violet' };
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.spec));
    } catch {
      /* 存不下就算了，主题不值得中断操作 */
    }
  }
}

export const theme = new ThemeState();
