/**
 * script/baseline.ts — 脚本写入的**撤销日志**（保证「同一 t 两次求值一致」）。
 *
 * ## 为什么不是「整层 style 快照」
 *
 * 最初的方案是记下每个 `.typo-script` 子树的 `style.cssText`，下一帧整段写回。
 * 那会**打掉 `syncDocDom` 每帧写进去的内联样式**（元素框、填充、阴影都在
 * 同一份 cssText 里）—— 表现是「拖动元素、松手后它跳回上一帧的位置」。
 *
 * 所以记的是**我们改过的那些属性/属性名的前值**：
 *  - 只回滚自己动过的东西，别的代码（syncDocDom / 图片 FX）随时可以继续写；
 *  - 回滚前先确认「当前值仍是我们上次写的那个」—— 别人已经改成新值就放手，
 *    不拿旧值把它盖回去；
 *  - 每帧从零开始记，脚本因此不需要自己清理，倒退 seek 也不会累积。
 *
 * 日志按**文档根**存在 WeakMap 里：舞台的根是稳定的，光栅化每帧新建一棵树
 * （旧日志随 DOM 一起被 GC，不需要回滚）。
 */

interface StyleEntry {
  kind: 'style';
  el: HTMLElement;
  prop: string;
  prev: string;
  prevPriority: string;
  /** 上次写进去的值；`''` = 移除。 */
  next: string;
}

interface AttrEntry {
  kind: 'attr';
  el: Element;
  name: string;
  prev: string | null;
  /** 上次写进去的值；`''` = 移除。 */
  next: string;
}

type Entry = StyleEntry | AttrEntry;

export interface ScriptWriteLog {
  /** 写一条内联样式（`null` = 移除）。 */
  style(el: HTMLElement, prop: string, value: string | null): void;
  /** 写一个属性（`null` = 移除）。 */
  attr(el: Element, name: string, value: string | null): void;
  /** 已写入的次数（预算用）。 */
  writes(): number;
  undo(): void;
}

export function createWriteLog(): ScriptWriteLog {
  const order: Entry[] = [];
  const styles = new Map<HTMLElement, Map<string, StyleEntry>>();
  const attrs = new Map<Element, Map<string, AttrEntry>>();
  let count = 0;

  return {
    style(el, prop, value): void {
      count++;
      let props = styles.get(el);
      if (!props) {
        props = new Map();
        styles.set(el, props);
      }
      let entry = props.get(prop);
      if (!entry) {
        entry = {
          kind: 'style',
          el,
          prop,
          prev: el.style.getPropertyValue(prop),
          prevPriority: el.style.getPropertyPriority(prop),
          next: '',
        };
        props.set(prop, entry);
        order.push(entry);
      }
      const next = value ?? '';
      entry.next = next;
      if (next === '') el.style.removeProperty(prop);
      else el.style.setProperty(prop, next);
    },

    attr(el, name, value): void {
      count++;
      let names = attrs.get(el);
      if (!names) {
        names = new Map();
        attrs.set(el, names);
      }
      let entry = names.get(name);
      if (!entry) {
        entry = { kind: 'attr', el, name, prev: el.getAttribute(name), next: '' };
        names.set(name, entry);
        order.push(entry);
      }
      const next = value ?? '';
      entry.next = next;
      if (next === '') el.removeAttribute(name);
      else el.setAttribute(name, next);
    },

    writes(): number {
      return count;
    },

    undo(): void {
      for (let i = order.length - 1; i >= 0; i--) {
        const e = order[i]!;
        if (e.kind === 'style') {
          if (e.el.style.getPropertyValue(e.prop) !== e.next) continue;
          if (e.prev === '') e.el.style.removeProperty(e.prop);
          else e.el.style.setProperty(e.prop, e.prev, e.prevPriority);
        } else {
          const cur = e.el.getAttribute(e.name);
          if (cur !== (e.next === '' ? null : e.next)) continue;
          if (e.prev === null) e.el.removeAttribute(e.name);
          else e.el.setAttribute(e.name, e.prev);
        }
      }
    },
  };
}

const logs = new WeakMap<HTMLElement, ScriptWriteLog>();

/** 回滚上一次对同一个根写入的内容。 */
export function undoScriptWrites(root: HTMLElement): void {
  const log = logs.get(root);
  if (!log) return;
  log.undo();
  logs.delete(root);
}

/** 记下这一帧的日志，等下一次求值前回滚。 */
export function commitScriptWrites(root: HTMLElement, log: ScriptWriteLog): void {
  logs.set(root, log);
}

/** 测试钩子：当前根有没有挂着一份待回滚的日志。 */
export function hasPendingScriptWrites(root: HTMLElement): boolean {
  return logs.has(root);
}
