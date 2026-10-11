<script lang="ts">
  /**
   * PluginImportDialog — 导入插件的**风险确认**。
   *
   * 单独一个组件是因为它有两个入口（插件面板的「导入」按钮、缺失提示条的
   * 「导入插件…」按钮），而这段话**必须一字不差地出现在两处**：它是
   * 「插件会执行任意代码」这个安全模型唯一的告知点，各写一遍必然漂。
   *
   * 文案在 `pl.risk.*`。**别弱化它** —— 没有沙箱是用户明确选定的模型，
   * 代价就是这一段必须说清楚。
   */
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { tr } from '../../i18n/index.svelte';
  import { confirmImport, type PickedPlugin } from '../plugin-actions';

  interface Props {
    pick: PickedPlugin;
    /** 确认或取消之后都调（调用方据此收起）。 */
    ondone: () => void;
  }
  const { pick, ondone }: Props = $props();

  async function onConfirm(): Promise<void> {
    // 先收起再导入：导入是异步的（可能几百毫秒），弹窗留在屏幕上会让人
    // 以为没点上而再点一次。
    ondone();
    await confirmImport(pick);
  }
</script>

<ConfirmDialog
  title={tr('pl.risk.title')}
  message={`${tr('pl.risk.body')}\n\n${tr('pl.risk.file', { name: pick.name })}`}
  confirmLabel={tr('pl.risk.ok')}
  cancelLabel={tr('pl.risk.cancel')}
  testid="plugin-risk"
  onconfirm={() => void onConfirm()}
  oncancel={ondone}
/>
