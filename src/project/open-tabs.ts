/**
 * open-tabs.ts — 记住「离开页面时打开着哪几份工程」（localStorage）。
 *
 * 用途只有一个：`/lab` 是第二个 HTML 入口，离开主应用再回来时页面从零开始、
 * 打开的工程全没了。这里把「打开过的工程」记下来，回到空界面时提示
 * 「要恢复上次打开的工程吗？」。
 *
 * 只记句柄 **key** 与名字（能恢复所需的最小信息），不记字节。
 * 工程真相在磁盘，句柄字节在 IndexedDB。
 *
 * 一律降级：localStorage 不可用（隐私模式 / Node 测试环境）或内容坏掉时
 * 静默返回空，绝不打断启动。
 */

export interface OpenTabRef {
  /** IndexedDB 里的句柄键。没有它的工程（未保存到磁盘）无从恢复，不记。 */
  key: string;
  /** 展示用名字（目录名）。 */
  name: string;
}

const TABS_KEY = 'artmatic.openTabs';
const DISMISS_KEY = 'artmatic.openTabsDismissed';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadOpenTabs(): OpenTabRef[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(TABS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is { key: string; name?: unknown } =>
          !!x && typeof x === 'object' && typeof (x as { key?: unknown }).key === 'string' && (x as { key: string }).key.length > 0,
      )
      .map((x) => ({ key: x.key, name: typeof x.name === 'string' && x.name ? x.name : x.key }));
  } catch {
    return [];
  }
}

/**
 * 写入当前打开的工程。空数组 = 清掉记录（全部关掉了，下次不该再问）。
 *
 * 默认「又开了工程 ⇒ 重置『已忽略』」—— 下次离开回来该问就问。启动时把记录
 * 写回**不是**「用户开了工程」，那时要 `keepDismiss: true`，否则「忽略过」
 * 会被自己抹掉、提示每回重进都弹。
 */
export function saveOpenTabs(tabs: readonly OpenTabRef[], opts: { keepDismiss?: boolean } = {}): void {
  const s = store();
  if (!s) return;
  try {
    if (tabs.length === 0) {
      s.removeItem(TABS_KEY);
    } else {
      s.setItem(TABS_KEY, JSON.stringify(tabs.map((t) => ({ key: t.key, name: t.name }))));
    }
    if (tabs.length > 0 && !opts.keepDismiss) s.removeItem(DISMISS_KEY);
  } catch {
    /* 纯偏好，写不进去就算了。 */
  }
}

export function isRestoreDismissed(): boolean {
  const s = store();
  return s ? s.getItem(DISMISS_KEY) === '1' : false;
}

/** 用户点了「忽略」：这次不再提示（下次重新开了工程会自动解除）。 */
export function dismissRestore(): void {
  const s = store();
  try {
    s?.setItem(DISMISS_KEY, '1');
  } catch {
    /* 同上 */
  }
}
