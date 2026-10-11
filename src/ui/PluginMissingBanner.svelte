<script lang="ts">
  /**
   * PluginMissingBanner — 「这个工程引用了没加载的插件」的提示条。
   *
   * 渲染层的降级本来就存在（未知特效原样透传、未知生成器返回 null），所以缺插件
   * 不崩、不毁图 —— 它**安静地什么都不做**，而用户看到的是「我这层特效怎么没反应」。
   * 这条提示就是那句解释，加上一个补载入口。
   *
   * 三个刻意的选择：
   *  - **不遮挡地浮在预览上方**（绝对定位、只占一条）：它是提示不是阻塞，
   *    工程照常能用，缺的那部分只是不出效果。
   *  - **不自动弹窗**：打开一个用了几十个特效的工程时突然弹一个「缺插件」会
   *    打断开场；而且那时用户还没看到画面，不知道缺的是哪一个。
   *  - **按插件聚合**（不是按片段）：同一个插件被十个片段引用时，
   *    用户要做的是「把那一个插件装回来」，十条一样的提示只会淹没重点。
   */
  import Button from './controls/Button.svelte';
  import Icon from './Icon.svelte';
  import PluginManagerModal from './plugin-manager/PluginManagerModal.svelte';
  import PluginImportDialog from './plugin-manager/PluginImportDialog.svelte';
  import { appState } from './app-state.svelte';
  import { tr } from '../i18n/index.svelte';
  import { missingText } from './plugin-manager/plugin-panel-model';
  import { beginImport, type PickedPlugin } from './plugin-actions';

  let managing = $state(false);
  let pending = $state<PickedPlugin | null>(null);

  const missing = $derived.by(() => {
    // 两个依赖都要：插件集合变了（挂上了）或工程内容变了（片段增删）都可能
    // 让这条提示出现 / 消失。
    appState.pluginRevision;
    void appState.version;
    return appState.plugins.missing(appState.store.project);
  });

  async function onQuickImport(): Promise<void> {
    const pick = await beginImport();
    if (pick) pending = pick;
  }
</script>

{#if missing.length > 0}
  <div class="banner" data-testid="plugin-missing-banner">
    <Icon name="puzzle" size={13} />
    <span class="title">{tr('pl.missing.title')}</span>
    <span class="body">{missingText(
        missing.map((m) => m.pluginId),
        tr,
      )}</span>
    <span class="note">{tr('pl.missing.note')}</span>
    <span class="spacer"></span>
    <Button
      label={tr('pl.missing.action')}
      variant="accent"
      testid="plugin-missing-import"
      onclick={() => void onQuickImport()}
    />
    <Button
      label={tr('pl.open')}
      variant="outline"
      testid="plugin-missing-manage"
      onclick={() => (managing = true)}
    />
  </div>
{/if}

{#if managing}
  <PluginManagerModal onclose={() => (managing = false)} />
{/if}

{#if pending}
  <PluginImportDialog pick={pending} ondone={() => (pending = null)} />
{/if}

<style>
  .banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .title {
    color: var(--text-primary);
    font-weight: 600;
  }
  .body {
    color: var(--text-secondary);
  }
  .note {
    color: var(--text-muted);
  }
  .spacer {
    flex: 1;
  }
</style>
