import { afterEach, describe, expect, it } from 'vitest';
import {
  dismissRestore,
  isRestoreDismissed,
  loadOpenTabs,
  saveOpenTabs,
} from '../../src/project/open-tabs';

/** 最小 localStorage 桩：真环境里它是浏览器对象，Node 里不存在。 */
function installStub(): void {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

describe('open-tabs', () => {
  it('无 localStorage 时全部静默降级', () => {
    expect(loadOpenTabs()).toEqual([]);
    expect(isRestoreDismissed()).toBe(false);
    expect(() => saveOpenTabs([{ key: 'a', name: 'A' }])).not.toThrow();
    expect(() => dismissRestore()).not.toThrow();
  });

  it('存取往返：写入后能读回', () => {
    installStub();
    saveOpenTabs([
      { key: 'k1', name: 'One' },
      { key: 'k2', name: 'Two' },
    ]);
    expect(loadOpenTabs()).toEqual([
      { key: 'k1', name: 'One' },
      { key: 'k2', name: 'Two' },
    ]);
  });

  it('清空（空数组）后记录消失；名字缺失时回退成 key', () => {
    installStub();
    saveOpenTabs([{ key: 'k1', name: '' }]);
    expect(loadOpenTabs()).toEqual([{ key: 'k1', name: 'k1' }]);
    saveOpenTabs([]);
    expect(loadOpenTabs()).toEqual([]);
  });

  it('忽略标记：dismiss 后为真；再开工程时被重置', () => {
    installStub();
    saveOpenTabs([{ key: 'k1', name: 'One' }]);
    expect(isRestoreDismissed()).toBe(false);
    dismissRestore();
    expect(isRestoreDismissed()).toBe(true);
    // 又开了工程 ⇒ 下次回来该问就问
    saveOpenTabs([{ key: 'k2', name: 'Two' }]);
    expect(isRestoreDismissed()).toBe(false);
  });

  it('keepDismiss：启动时把记录写回不该抹掉「已忽略」', () => {
    installStub();
    saveOpenTabs([{ key: 'k1', name: 'One' }]);
    dismissRestore();
    // 重新进页面：init 会把记录写回（keepDismiss），提示不该再弹
    saveOpenTabs([{ key: 'k1', name: 'One' }], { keepDismiss: true });
    expect(isRestoreDismissed()).toBe(true);
    expect(loadOpenTabs()).toEqual([{ key: 'k1', name: 'One' }]);
  });

  it('坏内容降级成空数组，不抛异常', () => {
    installStub();
    localStorage.setItem('artmatic.openTabs', '{ not json');
    expect(loadOpenTabs()).toEqual([]);
    localStorage.setItem('artmatic.openTabs', '{"a":1}');
    expect(loadOpenTabs()).toEqual([]);
  });
});
