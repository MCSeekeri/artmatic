<script lang="ts">
  /**
   * ConfirmDialog — 通用确认弹窗（是 / 否）。
   *
   * 值得单独一个组件，是因为**不可逆动作的处理必须一致**：现在只有
   * 「关闭未保存的工程」一处，但它会增长（覆盖保存、删除素材…），
   * 每处各写一遍必然出现「有的能取消、有的按了就跑」。
   *
   * 两条约定：
   * - `confirmLabel` 要能**独立读懂**。「放弃改动并关闭」比「确定」好得多 ——
   *   用户在处理第二个弹窗时已经不记得第一个写了什么。
   * - 破坏性动作传 `danger`，按钮走危险色，与「保存」「导出」那类区分开。
   */
  import Modal from './controls/Modal.svelte';
  import Button from './controls/Button.svelte';

  interface Props {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    /** 确认是破坏性的：按钮用 danger 变体。 */
    danger?: boolean;
    testid: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  const {
    title,
    message,
    confirmLabel,
    cancelLabel = '取消',
    danger = false,
    testid,
    onconfirm,
    oncancel,
  }: Props = $props();
</script>

<Modal {title} {testid} onclose={oncancel}>
  <p class="msg">{message}</p>
  <div class="actions">
    <Button label={cancelLabel} variant="outline" testid={`${testid}-cancel`} onclick={oncancel} />
    <Button
      label={confirmLabel}
      variant={danger ? 'danger' : 'accent'}
      testid={`${testid}-ok`}
      onclick={onconfirm}
    />
  </div>
</Modal>

<style>
  .msg {
    margin: 0 0 var(--sp-5);
    color: var(--text-secondary);
    font-size: var(--fs-md);
    line-height: 1.6;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-3);
  }
</style>
