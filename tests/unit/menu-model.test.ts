import { describe, expect, it } from 'vitest';
import {
  backLevel,
  edgeLevel,
  hoverLevel,
  initialMenuState,
  itemsAtLevel,
  keyIntent,
  moveLevel,
  openSubmenu,
  separator,
  stepIndex,
  submenu,
  type MenuItem,
} from '../../src/ui/controls/menu-model';

const tree = (): MenuItem[] => [
  {
    id: 'add',
    label: '添加片段',
    children: [
      { id: 'add-algo', label: '算法', children: [
        { id: 'gen-rule110', label: 'Rule 110' },
        { id: 'gen-mandelbrot', label: 'Mandelbrot' },
      ] },
      { id: 'add-solid', label: '纯色' },
    ],
  },
  separator('s1'),
  { id: 'rename', label: '重命名' },
  { id: 'remove', label: '删除轨道', danger: true },
  separator('s2'),
  { id: 'disabled-x', label: '不可用', disabled: true },
  { id: 'last', label: '末尾' },
];

describe('构造助手', () => {
  it('separator 只有 id 与 separator 标记', () => {
    expect(separator('x')).toEqual({ id: 'x', separator: true });
  });

  it('submenu 空 children 时降级为 disabled（不留一个点不开的死菜单）', () => {
    expect(submenu('a', '空', []).disabled).toBe(true);
    expect(submenu('a', '非空', [{ id: 'b', label: 'B' }]).children).toHaveLength(1);
  });
});

describe('索引导航 — 跳过分隔线与 disabled', () => {
  it('stepIndex 向下跳过 sep 与 disabled', () => {
    const t = tree();
    expect(stepIndex(t, 0, 1)).toBe(2); // 0 -> 跳过 s1 -> 2 (rename)
    expect(stepIndex(t, 2, 1)).toBe(3); // rename -> remove
    expect(stepIndex(t, 3, 1)).toBe(6); // remove -> 跳过 s2 与 disabled -> 6 (last)
  });

  it('stepIndex 向上同样跳过并环绕', () => {
    const t = tree();
    expect(stepIndex(t, 6, -1)).toBe(3);
    expect(stepIndex(t, 0, -1)).toBe(6); // 环绕回最后一个可选
  });

  it('edgeLevel 定位到首个/末个可选项', () => {
    const t = tree();
    let s = initialMenuState(t);
    expect(s.levels[0]).toBe(0);
    s = edgeLevel(t, s, 'last');
    expect(s.levels[0]).toBe(6);
    s = edgeLevel(t, s, 'first');
    expect(s.levels[0]).toBe(0);
  });

  it('初始状态高亮首个可选，而不是分隔线', () => {
    const t = [separator('s'), { id: 'a', label: 'A' }];
    expect(initialMenuState(t).levels[0]).toBe(1);
  });
});

describe('二级菜单开合', () => {
  it('openSubmenu 进入一层，高亮其首个可选项', () => {
    const t = tree();
    const s = openSubmenu(t, initialMenuState(t)); // 高亮 'add' 且它有 children
    expect(s.levels).toEqual([0, 0]);
    expect(itemsAtLevel(t, 1, s).map((i) => i.id)).toEqual(['add-algo', 'add-solid']);
  });

  it('对没有 children 的项 openSubmenu 原样返回', () => {
    const t = tree();
    let s = initialMenuState(t);
    s = moveLevel(t, s, 1); // → rename（无 children）
    expect(openSubmenu(t, s)).toEqual(s);
  });

  it('三层也能进（算法 → 具体生成器）', () => {
    const t = tree();
    let s = initialMenuState(t);
    s = openSubmenu(t, s); // level 1，高亮 add-algo
    s = openSubmenu(t, s); // level 2，高亮 gen-rule110
    expect(s.levels).toEqual([0, 0, 0]);
    expect(itemsAtLevel(t, 2, s).map((i) => i.id)).toEqual(['gen-rule110', 'gen-mandelbrot']);
  });

  it('backLevel 退一层；根层再退返回 null（该整个关掉）', () => {
    const t = tree();
    let s = openSubmenu(t, initialMenuState(t));
    const back = backLevel(s);
    expect(back?.levels).toEqual([0]);
    expect(backLevel({ levels: [0] })).toBeNull();
  });

  it('itemsAtLevel 越界时返回空数组而不是抛错', () => {
    const t = tree();
    expect(itemsAtLevel(t, 5, { levels: [0, 0, 0, 0, 0] })).toEqual([]);
  });
});

describe('moveLevel 只动当前层', () => {
  it('改了深层，外层高亮不受影响', () => {
    const t = tree();
    let s = openSubmenu(t, initialMenuState(t));
    s = moveLevel(t, s, 1);
    expect(s.levels[0]).toBe(0); // 根层仍是「添加片段」
    expect(s.levels[1]).toBe(1); // 子层移到「纯色」
  });
});

describe('hoverLevel — 鼠标划过', () => {
  it('划过带 children 的项会展开子菜单', () => {
    const t = tree();
    const s = hoverLevel(t, initialMenuState(t), 0, 0);
    expect(s.levels).toEqual([0, 0]);
  });

  it('划过无 children 的项会收起已展开的深层', () => {
    const t = tree();
    let s = hoverLevel(t, initialMenuState(t), 0, 0); // 根层：展开「添加片段」
    expect(s.levels).toEqual([0, 0]);
    s = hoverLevel(t, s, 0, 2); // 仍在根层，划到 rename（无 children）
    expect(s.levels).toEqual([2]);
  });

  it('划过分隔线或 disabled 时不改状态', () => {
    const t = tree();
    const before = initialMenuState(t);
    expect(hoverLevel(t, before, 0, 1)).toEqual(before); // s1
    expect(hoverLevel(t, before, 0, 5)).toEqual(before); // disabled-x
  });

  it('在子层里划过：只影响这个子层，不误动根层', () => {
    const t = tree();
    let s = hoverLevel(t, initialMenuState(t), 0, 0); // levels [0, 0]，高亮 add-algo
    s = hoverLevel(t, s, 1, 1); // 子层划到「纯色」（无 children）
    expect(s.levels).toEqual([0, 1]);
  });

  it('level 超出已展开深度时不动状态（防止下标错位）', () => {
    const t = tree();
    const before = initialMenuState(t); // 只有一层
    expect(hoverLevel(t, before, 3, 0)).toEqual(before);
  });
});

describe('keyIntent', () => {
  it('上下 Home End 各归其位', () => {
    expect(keyIntent('ArrowDown')).toBe('next');
    expect(keyIntent('ArrowUp')).toBe('prev');
    expect(keyIntent('Home')).toBe('first');
    expect(keyIntent('End')).toBe('last');
  });

  it('Enter/Space 激活，Left 退一级，Right 进子菜单', () => {
    expect(keyIntent('Enter')).toBe('enter');
    expect(keyIntent(' ')).toBe('enter');
    expect(keyIntent('ArrowLeft')).toBe('back');
    expect(keyIntent('ArrowRight')).toBe('enter');
  });

  it('Esc 与 Tab 关闭整棵树', () => {
    expect(keyIntent('Escape')).toBe('close');
    expect(keyIntent('Tab')).toBe('close');
  });

  it('单字符是打字，其余放行', () => {
    expect(keyIntent('r')).toBe('type');
    expect(keyIntent('F5')).toBeNull();
    expect(keyIntent('Control')).toBeNull();
  });
});
