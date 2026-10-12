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
   * 正在行内改名的目标（元素或组合）。null = 没有在改名。
   *
   * 只记 id 与种类，不记「旧名字」——旧名字在开始改名时算一次放进
   * `renameDraft` / `renameOriginal`，之后只跟这两个字符串打交道。
   */
  let renaming = $state<{ kind: 'element' | 'group'; id: string } | null>(null);

  /** 输入框里的当前文本（`bind:value`）。 */
  let renameDraft = $state('');

  /**
   * 开始改名那一刻的原始文本。提交时用它判断「用户有没有真的改」——
   * 只是点一下再点走（失焦提交）不该落一笔空的撤销记录。
   */
  let renameOriginal = $state('');

  /**
   * 行内输入框的 DOM 引用。用**单元素数组**而不是 `let`：`bind:this` 挂可变
   * 绑定会被 svelte-check 报 `non_reactive_update`（与 controls/Menu.svelte
   * 的 `panels` 同一手法）。同一时刻只可能有一个输入框。
   */
  const renameInputs: HTMLInputElement[] = [];

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
    // 「组合」是新建组写进文档的默认名。组一旦改过名，行里就显示它自己的名字；
    // 没改过则沿用「拼接成员名」的预览（既有行为，便于一眼认出组里是什么）。
    // 两者共用一个字段（`group.name`）时只能这样区分，好在默认名就是唯一的判据。
    const defaultName = tr('typo.groupName');
    for (const r of layerRows(doc, expanded)) {
      if (r.kind !== 'group') continue;
      const renamed = r.group.name && r.group.name !== defaultName;
      out.set(r.id, renamed ? r.group.name : groupLabel(doc, r.group));
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
      // 组行双击 = 展开/折叠（单靠那个小三角不好点）。但**名称区**的双击是改名，
      // 必须排除掉 —— 双击的第二下 detail===2 会先于 dblclick 触发，不排除的话
      // 改名时会把组一起折叠了。
      const target = e.target;
      const onName = target instanceof Element && target.closest('.name') !== null;
      if (e.detail >= 2 && !onName) toggleExpand(row.id);
      return;
    }
    if (e.shiftKey || e.ctrlKey) editorState.toggle(row.id);
    else editorState.selectOnly(row.id);
  }

  /** 双击名称区开始改名（元素 / 组合都走它）。 */
  function startRename(row: LayerRow, e: MouseEvent): void {
    // 名称区的双击不要再冒泡给行 —— 否则组行会顺手把组折叠掉。
    e.preventDefault();
    e.stopPropagation();
    if (renaming?.id === row.id) return;
    renameOriginal =
      row.kind === 'group'
        ? groupNameById.get(row.id) ?? row.group.name
        : row.el.name || row.el.kind;
    renameDraft = renameOriginal;
    renaming = { kind: row.kind, id: row.id };
  }

  function cancelRename(): void {
    renaming = null;
  }

  /** 提交改名。Enter / 失焦都走它；空串或与原文相同则不发撤销记录。 */
  function commitRename(): void {
    const target = renaming;
    // target 为空就**什么都不写**：Enter 提交后输入框被移除，浏览器可能再补一个
    // blur；那次进来 target 已是 null，提前 return 避免在 Svelte 的 flush 里
    // 又写一次 rune（同类风险见 AGENTS §6.5）。
    if (!target) return;
    renaming = null;
    const value = renameDraft.trim();
    if (!value || value === renameOriginal.trim()) return;
    if (target.kind === 'group') editorState.renameGroup(target.id, value);
    else editorState.renameElement(target.id, value);
  }

  function onRenameKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  /** 输入框内的指针 / 点击不许冒泡：否则行的 onclick 会选元素、列表的拖曳排序会抢指针。 */
  function stop(e: Event): void {
    e.stopPropagation();
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

  /**
   * 改名输入框出现后自动聚焦并全选 —— 双击改名的心智就是「打字替换」。
   * 放在 `$effect` 而不是 `bind:this` 里：effect 跑在 DOM 更新之后，
   * `renameInputs[0]` 这时才是新挂上的那个输入框。
   */
  $effect(() => {
    if (!renaming) return;
    const input = renameInputs[0];
    if (!input) return;
    input.focus();
    input.select();
  });
</script>

<aside class="layers" data-testid="typo-layers">
  <!--
    行内改名输入框。元素行与组行共用一个 snippet —— 两处各写一份的话，
    「Enter 提交 / Esc 取消 / 失焦提交」这类细节迟早只会改到一处。
  -->
  {#snippet renameInput()}
    <input
      class="name-input"
      data-testid="layer-rename-input"
      bind:this={renameInputs[0]}
      bind:value={renameDraft}
      aria-label={tr('typo.layerRename')}
      onkeydown={onRenameKey}
      onblur={commitRename}
      onclick={stop}
      onpointerdown={stop}
    />
  {/snippet}
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
          {#if renaming?.id === row.id}
            {@render renameInput()}
          {:else}
            <span class="name" role="presentation" ondblclick={(e) => startRename(row, e)}>{groupNameById.get(row.id) ?? row.group.name}</span>
          {/if}
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
          {#if renaming?.id === row.id}
            {@render renameInput()}
          {:else}
            <span class="name" role="presentation" ondblclick={(e) => startRename(row, e)}>{row.el.name || row.el.kind}</span>
          {/if}
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
  /* 行内改名框：占住名称那一格，外观尽量贴近原来的文字，避免行高跳动。 */
  .name-input {
    flex: 1;
    min-width: 0;
    height: 18px;
    padding: 0 var(--sp-2);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-0);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-sm);
    outline: none;
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
