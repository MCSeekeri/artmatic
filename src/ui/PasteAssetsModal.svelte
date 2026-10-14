<script lang="ts">
  /**
   * PasteAssetsModal — 剪贴板里有素材时问「放到哪儿」。
   *
   * 时间轴视图里的一个岔路口：扔到播放头（立刻成为片段），还是先存进媒体池
   * （之后自己挑地方）。两条路都走 `media-import.ts` 那一份实现 —— 这个组件
   * 只负责把选择交回给调用方，它不认识工程、不认识 store，也不做导入。
   *
   * 另一个按钮是「取消」而不是「什么都不做」：粘贴是用户主动发起的动作，
   * 总得有一个明确的否定，否则点 backdrop 关掉会让人不确定素材去哪了。
   */
  import Modal from './controls/Modal.svelte';
  import Button from './controls/Button.svelte';
  import Icon from './Icon.svelte';
  import { clipboardAssetName, type ClipboardAsset } from './clipboard-assets';
  import type { PoolKind } from './media-pool';
  import type { IconName } from './icons';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    assets: ClipboardAsset[];
    /** 放到播放头（导入素材 + 建片段 + 选中）。 */
    onplace: () => void;
    /** 仅加入媒体池（只登记素材，不建片段）。 */
    onpool: () => void;
    oncancel: () => void;
  }
  const { assets, onplace, onpool, oncancel }: Props = $props();

  // 与媒体池的分组图标同一套（同一个语义就该长一样）。
  const KIND_ICON: Record<PoolKind, IconName> = {
    video: 'video',
    image: 'image',
    audio: 'audio-lines',
  };
</script>

<Modal title={tr('pool.pasteTitle')} testid="paste-assets" onclose={oncancel}>
  <p class="msg">{tr('pool.pasteMessage', { n: assets.length })}</p>
  <ul class="list" data-testid="paste-assets-list">
    {#each assets as a, i (i)}
      <!-- 序号做 key：File 对象在两次粘贴之间可能是同一个引用，而名字可能重复。 -->
      {@const name = clipboardAssetName(a)}
      <li class="row">
        <Icon name={KIND_ICON[a.kind]} size={13} />
        <span class="name" title={name}>{name}</span>
      </li>
    {/each}
  </ul>

  {#snippet footer()}
    <Button
      label={tr('common.cancel')}
      variant="outline"
      testid="paste-assets-cancel"
      onclick={oncancel}
    />
    <Button
      label={tr('pool.pasteToPool')}
      variant="outline"
      testid="paste-assets-pool"
      onclick={onpool}
    />
    <Button
      label={tr('pool.pasteToTimeline')}
      variant="accent"
      testid="paste-assets-place"
      onclick={onplace}
    />
  {/snippet}
</Modal>

<style>
  .msg {
    margin: 0 0 var(--sp-4);
    color: var(--text-secondary);
    font-size: var(--fs-md);
    line-height: 1.6;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    /* 一次粘十个文件时不要撑破 modal（Modal 的 body 自己会滚，这里只兜住单项高度） */
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    color: var(--text-muted);
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .name {
    flex: 1;
    min-width: 0;
    color: var(--text-primary);
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
