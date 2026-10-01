/**
 * focus.ts — 全局快捷键的豁免判据。
 *
 * 背景：应用在 window 上接管了 Space / Delete / Ctrl+Z 等一批键。自研控件
 * （下拉、滑杆、数字框、复选框）**不是**原生 `<input>`，所以原来那句
 * 「target 是 INPUT/SELECT/TEXTAREA 就放行」对它们全部失效——在下拉上按
 * Space 会同时打开下拉和开始播放。约定是：所有自研控件的根节点带
 * `data-exempt`，这里统一识别。
 */

const NATIVE_TEXT_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export function isTextEditable(el: Element | null): boolean {
  if (!el) return false;
  if (NATIVE_TEXT_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** 该目标是否「自己处理键盘」，全局快捷键必须让路。 */
export function isExempt(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isTextEditable(target)) return true;
  return target.closest('[data-exempt]') !== null;
}

/**
 * 这些角色会**自己吃掉 Space**（浏览器把 Space 当激活键 / 控件自己的语义键）。
 * 若不管，聚焦在按钮上按 Space 会「激活按钮」+「全局 togglePlay」同时发生。
 */
const SPACE_OWNER_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'listbox',
  'menu',
  'menuitem',
  'option',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
]);

export function ownsSpaceKey(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'BUTTON') return true;
  const role = el.getAttribute('role');
  return role !== null && SPACE_OWNER_ROLES.has(role);
}

/** 当前焦点元素是否自己吃 Space。传给全局 Space 快捷键做二次判断。 */
export function activeElementOwnsSpace(): boolean {
  if (typeof document === 'undefined') return false;
  return ownsSpaceKey(document.activeElement);
}
