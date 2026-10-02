<script lang="ts">
  /**
   * LayersPanel — 图层树（数组末尾 = 最前景，所以**列表从上往下就是从前到后**）。
   *
   * 层级调整放在这里最自然：Ribbon 的四个按钮只能一层层点，而图层列表能
   * 一眼看到谁盖着谁。两处共用 editorState 的同一套 order 动作，不各写一份。
   */
  import Icon from '../Icon.svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import type { TypographyElement } from '../../typography/document';
  import type { IconName } from '../icons';

  const KIND_ICON: Record<TypographyElement['kind'], IconName> = {
    text: 'type',
    shape: 'shapes',
    image: 'image',
  };

  /**
   * 元素是原地改的对象，所以这里**返回浅拷贝**而不是直接给 `editorState.elements`。
   *
   * 这不是为了性能，是为了正确性：Svelte 5 的 `$derived` 与 `{#each}` 都靠
   * `===` 判断要不要往下传播。`editorState.elements` 每次返回的是**同一个数组、
   * 同一批对象引用** —— 派生重跑了，但值没变，模板静默断更。
   * 症状就是「点眼睛图标，图标不变」这种「改了但没刷新」。
   * （AGENTS §7 记过三次同族事故：轨道列表、片段位置、检查器。）
   */
  const items = $derived.by(() => {
    void appState.version;
    return editorState.elements.map((e) => ({ ...e }));
  });

  /** 行内图标读的是拷贝上的字段，所以它们会跟着 version 一起刷新。 */
  const rows = $derived([...items].reverse());

  function rowClick(e: MouseEvent, el: TypographyElement): void {
    if (e.shiftKey || e.ctrlKey) editorState.toggle(el.id);
    else editorState.selectOnly(el.id);
  }

  function toggleField(el: TypographyElement, field: 'locked' | 'visible', e: MouseEvent): void {
    e.stopPropagation();
    editorState.commit(field === 'locked' ? '切换锁定' : '切换隐藏', (doc) => {
      const target = doc.elements.find((x) => x.id === el.id);
      if (target) target[field] = !target[field];
    });
  }

  /** 层级上下移：一次一层，走与 Ribbon 相同的选择集语义。 */
  function move(el: TypographyElement, dir: -1 | 1): void {
    editorState.selectOnly(el.id);
    editorState.order(dir === 1 ? 'forward' : 'backward');
  }
</script>

<aside class="layers" data-testid="typo-layers">
  <div class="head">图层</div>
  <div class="list">
    <!-- 反转：数组末尾是最前景，列表顶部也应当是最前景（NLE / 设计工具的通用约定）。 -->
    {#each rows as el (el.id)}
      <div
        class="row"
        class:selected={editorState.isSelected(el.id)}
        class:hidden={!el.visible}
        role="presentation"
        data-testid="typo-layer-row"
        data-el-id={el.id}
        onclick={(e) => rowClick(e, el)}
      >
        <Icon name={KIND_ICON[el.kind]} size={12} />
        <span class="name">{el.name || el.kind}</span>
        <span class="acts">
          <button
            type="button"
            class="ic"
            aria-label="上移一层"
            data-testid="typo-layer-up"
            onclick={(e) => {
              e.stopPropagation();
              move(el, 1);
            }}
          >
            <Icon name="move-up" size={11} />
          </button>
          <button
            type="button"
            class="ic"
            aria-label="下移一层"
            data-testid="typo-layer-down"
            onclick={(e) => {
              e.stopPropagation();
              move(el, -1);
            }}
          >
            <Icon name="move-down" size={11} />
          </button>
          <button
            type="button"
            class="ic"
            class:on={!el.visible}
            aria-label="显示 / 隐藏"
            data-testid="typo-layer-eye"
            onclick={(e) => toggleField(el, 'visible', e)}
          >
            <Icon name={el.visible ? 'eye' : 'eye-off'} size={11} />
          </button>
          <button
            type="button"
            class="ic"
            class:on={el.locked}
            aria-label={el.locked ? '解锁' : '锁定'}
            aria-pressed={el.locked}
            data-testid="typo-layer-lock"
            onclick={(e) => toggleField(el, 'locked', e)}
          >
            <!-- 图标本身换（不是只变色）：与眼睛一致，一眼能看出状态，
                 也让「改了但没刷新」这类问题在肉眼和测试里都藏不住。 -->
            <Icon name={el.locked ? 'lock' : 'lock-open'} size={11} />
          </button>
        </span>
      </div>
    {/each}

    {#if items.length === 0}
      <p class="empty">还没有元素。用「开始 → 文本框」或「插入 → 图形」加一个。</p>
    {/if}
  </div>
</aside>

<style>
  .layers {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface-1);
    border-left: 1px solid var(--border);
  }
  .head {
    padding: 4px var(--sp-4);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border);
  }
  .list {
    overflow: auto;
    min-height: 0;
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
  .empty {
    padding: var(--sp-4);
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }
</style>
