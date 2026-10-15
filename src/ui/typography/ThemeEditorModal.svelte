<script lang="ts">
  /**
   * ThemeEditorModal — 自定义配色方案的编辑器（「设计」选项卡的「编辑方案」）。
   *
   * 两条路径共用一个弹窗：
   *   - 当前是**自定义**方案 → 就地改槽位（保存是一笔更新）；
   *   - 当前是**内置**方案 → 打开即复制成一份自定义方案（内置数据表只读），
   *     保存时连「新建 + 设为当前」一起落库（一笔撤销）。
   *
   * 只开放 8 个可变槽（dk2 / lt2 / accent1..6）：两个端点（纯白 / 纯黑）是
   * 所有方案共有的约定，取色卡的第一列永远画它们 —— 放开了只会得到
   * 「黑色不是纯黑」的怪方案。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import ColorField from '../controls/ColorField.svelte';
  import Field from '../controls/Field.svelte';
  import {
    THEME_SLOTS,
    THEME_SLOT_LABEL,
    withSlotColor,
    type ThemeSlot,
    type TypographyTheme,
  } from '../../typography/theme';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /**
     * 草稿的初值用**函数**：弹窗每次打开都是新建的，要的是「打开那一刻的快照」。
     * 传对象会让 Svelte 报「只捕获了初值」—— 用函数表达出来更清楚。
     */
    initialOf: () => TypographyTheme;
    title: string;
    onclose: () => void;
    /** 保存（一笔撤销由调用方落）。 */
    onsave: (theme: TypographyTheme) => void;
  }
  const { initialOf, title, onclose, onsave }: Props = $props();

  // svelte-ignore state_referenced_locally -- 只取挂载那一刻的快照，正是意图
  const draft = $state<TypographyTheme>(initialOf());
  let name = $state(draft.name ?? '');

  /** 两个端点只读（见文件头）。 */
  const FIXED: ReadonlySet<ThemeSlot> = new Set<ThemeSlot>(['lt1', 'dk1']);

  function save(): void {
    const finalName = name.trim();
    // 空名字不保存：图库里认不出它，保存了等于把它藏起来
    if (!finalName) return;
    onsave({ ...draft, name: finalName });
    onclose();
  }
</script>

<Modal {title} onclose={onclose} testid="theme-editor-modal">
  <Field label={tr('rib.themeName')} labelWidth={64}>
    <input
      class="name"
      type="text"
      bind:value={name}
      maxlength={40}
      data-testid="theme-editor-name"
      onkeydown={(e) => {
        if (e.key === 'Enter') save();
      }}
    />
  </Field>

  <div class="slots">
    {#each THEME_SLOTS as slot (slot)}
      <div class="slot" class:fixed={FIXED.has(slot)} data-testid={`theme-editor-slot-${slot}`}>
        {#if FIXED.has(slot)}
          <span class="sw" style:--c={draft.colors[slot]} aria-hidden="true"></span>
        {:else}
          <ColorField
            label={tr(THEME_SLOT_LABEL[slot])}
            value={draft.colors[slot]}
            theme={draft}
            testid={`theme-editor-color-${slot}`}
            onchange={(v) => {
              draft.colors = withSlotColor(draft, slot, v).colors;
            }}
          />
        {/if}
        <span class="slot-label">{tr(THEME_SLOT_LABEL[slot])}</span>
      </div>
    {/each}
  </div>

  <p class="hint">{tr('rib.themeEditHint')}</p>

  <div class="acts">
    <Button label={tr('common.cancel')} testid="theme-editor-cancel" onclick={onclose} />
    <Button
      label={tr('common.save')}
      variant="accent"
      testid="theme-editor-save"
      disabled={!name.trim()}
      onclick={save}
    />
  </div>
</Modal>

<style>
  .name {
    width: 100%;
    height: var(--control-h, 24px);
    padding: 0 var(--sp-2);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-sm);
    color: var(--input-fg);
    font-size: var(--fs-sm);
  }
  .slots {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-2) var(--sp-4);
    margin-top: var(--sp-3);
  }
  .slot {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }
  .slot-label {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* 两个端点槽：只读，画一块静态色（不开放编辑，见文件头）。 */
  .sw {
    width: 26px;
    height: 18px;
    flex: none;
    background: var(--c);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .slot.fixed .slot-label {
    color: var(--text-muted);
  }
  .hint {
    margin: var(--sp-3) 0 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
    line-height: 1.6;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
    margin-top: var(--sp-4);
  }
</style>
