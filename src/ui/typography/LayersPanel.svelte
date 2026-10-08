<script lang="ts">
  /**
   * LayersPanel — 图层树（数组末尾 = 最前景，所以**列表从上往下就是从前到后**）。
   *
   * 层级调整放在这里最自然：Ribbon 的四个按钮只能一层层点，而图层列表能
   * 一眼看到谁盖着谁。两处共用 editorState 的同一套 order 动作，不各写一份。
   *
   * 组合在这里**默认折叠**：只出一行组，展开后才列出成员。组行的上下移走
   * 与 Ribbon 同一套「整块移动」（`moveBlockOne`）—— 逐层移动会把成员拆散、
   * 组合就散了。因此**组行本身不参与拖曳排序**，拖曳只作用于元素行。
   */
  import Icon from '../Icon.svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { reorder } from '../drag-reorder';
  import { tr } from '../../i18n/index.svelte';
  import { groupLabel, layerRows, type LayerRow } from '../../typography/groups';
  import type { TypographyElement } from '../../typography/document';
  import type { IconName } from '../icons';

  const KIND_ICON: Record<TypographyElement['kind'], IconName> = {
    text: 'type',
    shape: 'shapes',
    image: 'image',
  };

  /** 展开的组合 id。纯界面态，不进文档（与「看哪一栏」同类）。 */
  let expanded = $state<Set<string>>(new Set());

  /**
   * 行模型。元素/组都是**原地改的对象**，所以这里返回浅拷贝而不是直接给引用 ——
   * Svelte 5 的 `$derived` 与 `{#each}` 都靠 `===` 判断要不要往下传播，
   * 给同一批引用会让派生重跑了但值没变、模板静默断更（AGENTS §7 的老朋友）。
   */
  const rows = $derived.by<LayerRow[]>(() => {
    void appState.version;
    const doc = editorState.doc;
    if (!doc) return [];
    return layerRows(doc, expanded).map((r) =>
      r.kind === 'group'
        ? { ...r, memberIds: [...r.memberIds], group: { ...r.group } }
        : { ...r, el: { ...r.el } },
    );
  });

  const groupNameById = $derived.by<Map<string, string>>(() => {
    void appState.version;
    const doc = editorState.doc;
    const out = new Map<string, string>();
    if (!doc) return out;
    for (const r of layerRows(doc, expanded)) {
      if (r.kind === 'group') out.set(r.id, groupLabel(doc, r.group));
    }
    return out;
  });

  function toggleExpand(gid: string): void {
    const next = new Set(expanded);
    if (next.has(gid)) next.delete(gid);
    else next.add(gid);
    expanded = next;
  }

  function rowClick(e: MouseEvent, row: LayerRow): void {
    if (row.kind === 'group') {
      editorState.selectGroup(row.id);
      // 组行双击 = 展开/折叠（单靠那个小三角不好点）。
      if (e.detail >= 2) toggleExpand(row.id);
      return;
    }
    if (e.shiftKey || e.ctrlKey) editorState.toggle(row.id);
    else editorState.selectOnly(row.id);
  }

  function rowSelected(row: LayerRow): boolean {
    if (row.kind === 'group') {
      return row.memberIds.length > 0 && row.memberIds.every((id) => editorState.isSelected(id));
    }
    return editorState.isSelected(row.id);
  }

  function toggleField(row: LayerRow, field: 'locked' | 'visible', e: MouseEvent): void {
    e.stopPropagation();
    const ids = row.kind === 'group' ? row.memberIds : [row.id];
    editorState.commit(field === 'locked' ? tr('typo.undo.lock') : tr('typo.undo.hide'), (doc) => {
      for (const id of ids) {
        const target = doc.elements.find((x) => x.id === id);
        if (target) target[field] = !target[field];
      }
    });
  }

  /** 层级上下移：一次一层，走与 Ribbon 相同的选择集语义（组走整块移动）。 */
  function move(row: LayerRow, dir: -1 | 1): void {
    if (row.kind === 'group') editorState.selectGroup(row.id);
    else editorState.selectOnly(row.id);
    editorState.order(dir === 1 ? 'forward' : 'backward');
  }

  function hidden(row: LayerRow): boolean {
    if (row.kind === 'group') {
      const doc = editorState.doc;
      if (!doc) return false;
      return row.memberIds.every((id) => doc.elements.find((x) => x.id === id)?.visible === false);
    }
    return !row.el.visible;
  }

  function locked(row: LayerRow): boolean {
    if (row.kind === 'group') {
      const doc = editorState.doc;
      if (!doc) return false;
      return row.memberIds.every((id) => doc.elements.find((x) => x.id === id)?.locked === true);
    }
    return row.el.locked;
  }

  /**
   * 拖曳排序的下标换算。
   *
   * 列表是**倒序**渲染的（数组末尾 = 最前景 = 列表顶部），所以视觉下标要换算回
   * 数组下标：`len - 1 - i`。组行不在拖曳集合里（见文件头），所以这里拿到的一定
   * 是元素行 —— 但组行会占用**视觉位置**，直接按 `rows` 的下标换算会错。
   * 因此换算走「该元素在数组里的实际下标」，而不是按行序号推。
   */
  function arrayIndexOfElement(id: string): number {
    const doc = editorState.doc;
    if (!doc) return -1;
    return doc.elements.findIndex((e) => e.id === id);
  }

  const elementRowCount = $derived(rows.filter((r) => r.kind === 'element').length);
</script>

<aside class="layers" data-testid="typo-layers">
  <div
    class="list"
    use:reorder={{
      axis: 'y',
      itemSelector: '[data-testid=typo-layer-row]',
      disabled: elementRowCount < 2,
      onReorder: (from, to) => {
        const picked = rows.filter((r) => r.kind === 'element');
        const a = picked[from];
        const b = picked[to];
        if (!a || !b || a.kind !== 'element' || b.kind !== 'element') return;
        editorState.moveElement(arrayIndexOfElement(a.id), arrayIndexOfElement(b.id));
      },
    }}
  >
    {#each rows as row (row.id)}
      {#if row.kind === 'group'}
        <div
          class="row group"
          class:selected={rowSelected(row)}
          class:hidden={hidden(row)}
          role="presentation"
          data-testid="typo-layer-group"
          data-group-id={row.id}
          onclick={(e) => rowClick(e, row)}
        >
          <button
            type="button"
            class="ic twist"
            aria-label={row.expanded ? tr('typo.groupCollapse') : tr('typo.groupExpand')}
            aria-expanded={row.expanded}
            data-testid="typo-layer-twist"
            onclick={(e) => {
              e.stopPropagation();
              toggleExpand(row.id);
            }}
          >
            <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} size={11} />
          </button>
          <Icon name="group" size={12} />
          <span class="name">{groupNameById.get(row.id) ?? row.group.name}</span>
          <span class="count">{row.memberIds.length}</span>
          <span class="acts">
            <button
              type="button"
              class="ic"
              aria-label={tr('typo.layerUp')}
              data-testid="typo-layer-up"
              onclick={(e) => {
                e.stopPropagation();
                move(row, 1);
              }}
            >
              <Icon name="move-up" size={11} />
            </button>
            <button
              type="button"
              class="ic"
              aria-label={tr('typo.layerDown')}
              data-testid="typo-layer-down"
              onclick={(e) => {
                e.stopPropagation();
                move(row, -1);
              }}
            >
              <Icon name="move-down" size={11} />
            </button>
            <button
              type="button"
              class="ic"
              class:on={hidden(row)}
              aria-label={tr('typo.layerToggleVisible')}
              data-testid="typo-layer-eye"
              onclick={(e) => toggleField(row, 'visible', e)}
            >
              <Icon name={hidden(row) ? 'eye-off' : 'eye'} size={11} />
            </button>
            <button
              type="button"
              class="ic"
              class:on={locked(row)}
              aria-label={locked(row) ? tr('typo.layerUnlock') : tr('typo.layerLock')}
              aria-pressed={locked(row)}
              data-testid="typo-layer-lock"
              onclick={(e) => toggleField(row, 'locked', e)}
            >
              <Icon name={locked(row) ? 'lock' : 'lock-open'} size={11} />
            </button>
          </span>
        </div>
      {:else}
        <div
          class="row"
          class:selected={rowSelected(row)}
          class:hidden={hidden(row)}
          class:nested={row.inGroup}
          role="presentation"
          data-testid="typo-layer-row"
          data-el-id={row.id}
          onclick={(e) => rowClick(e, row)}
        >
          <Icon name={KIND_ICON[row.el.kind]} size={12} />
          <span class="name">{row.el.name || row.el.kind}</span>
          <span class="acts">
            <button
              type="button"
              class="ic"
              aria-label={tr('typo.layerUp')}
              data-testid="typo-layer-up"
              onclick={(e) => {
                e.stopPropagation();
                move(row, 1);
              }}
            >
              <Icon name="move-up" size={11} />
            </button>
            <button
              type="button"
              class="ic"
              aria-label={tr('typo.layerDown')}
              data-testid="typo-layer-down"
              onclick={(e) => {
                e.stopPropagation();
                move(row, -1);
              }}
            >
              <Icon name="move-down" size={11} />
            </button>
            <button
              type="button"
              class="ic"
              class:on={hidden(row)}
              aria-label={tr('typo.layerToggleVisible')}
              data-testid="typo-layer-eye"
              onclick={(e) => toggleField(row, 'visible', e)}
            >
              <Icon name={hidden(row) ? 'eye-off' : 'eye'} size={11} />
            </button>
            <button
              type="button"
              class="ic"
              class:on={locked(row)}
              aria-label={locked(row) ? tr('typo.layerUnlock') : tr('typo.layerLock')}
              aria-pressed={locked(row)}
              data-testid="typo-layer-lock"
              onclick={(e) => toggleField(row, 'locked', e)}
            >
              <!-- 图标本身换（不是只变色）：与眼睛一致，一眼能看出状态，
                   也让「改了但没刷新」这类问题在肉眼和测试里都藏不住。 -->
              <Icon name={locked(row) ? 'lock' : 'lock-open'} size={11} />
            </button>
          </span>
        </div>
      {/if}
    {/each}

    {#if rows.length === 0}
      <p class="empty">{tr('typo.layersEmpty')}</p>
    {/if}
  </div>
</aside>

<style>
  .layers {
    display: grid;
    /* 标题行已经在 SidePanel 的选项卡里了，这里只有列表。 */
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    background: var(--surface-1);
  }
  .list {
    overflow: auto;
    min-height: 0;
    /* 列表**顶对齐**：条目从上往下排。加这条是防御性的 ——
       grid 的 `align-content` 默认值是 normal（在部分环境里表现成按剩余空间分布），
       一旦哪一层容器变成 grid，条目就会被推到下方。 */
    align-content: start;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 22px;
    padding: 0 var(--sp-3);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    cursor: pointer;
    user-select: none;
    /* 拖曳排序：不设过渡，否则跟随指针会拖尾。 */
    will-change: transform;
  }
  /* 组内的成员缩进一层。 */
  .row.nested {
    padding-left: calc(var(--sp-3) + 14px);
  }
  .row.group {
    color: var(--text-primary);
  }
  .count {
    flex: none;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .list :global(.is-dragging) {
    background: var(--surface-hover);
  }
  .list :global(.is-reordering) {
    cursor: grabbing;
  }
  .row:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  /* 选中态用主题色 —— 与「主题色只出现在选中/激活」一致。 */
  .row.selected {
    background: var(--accent-weak);
    color: var(--accent);
  }
  .row.hidden .name {
    color: var(--text-disabled);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 1px;
    opacity: 0;
  }
  .row:hover .acts,
  .row.selected .acts {
    opacity: 1;
  }
  .ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: inherit;
    cursor: pointer;
  }
  .ic:hover {
    color: var(--text-primary);
  }
  .ic.on {
    color: var(--accent);
  }
  /* 折叠三角常显 —— 它是「这行是组」的唯一线索。 */
  .twist {
    flex: none;
    opacity: 1;
    margin-left: -4px;
  }
  .empty {
    padding: var(--sp-4);
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }
</style>
