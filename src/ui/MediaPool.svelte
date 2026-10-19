<script lang="ts">
  /**
   * MediaPool — 媒体池的内容：这个工程里已导入的素材，一行一条。
   *
   * 分组顺序固定为视频 → 图片 → 音频（空组不显示），组内按导入顺序。
   * 列表怎么合成、分组怎么切、从素材怎么建片段，全在 `media-pool.ts`
   * 里（纯函数，有单测）；这里只负责把 appState 的几个值喂进去、把它画出来。
   *
   * 「插入」落在**播放头**上，优先用主选中片段所在的那条轨 —— 用户此刻在编辑
   * 哪条轨，新素材就该落到哪里，这是从「我正在拼这一段」的意图推出来的。
   */
  import Icon from './Icon.svelte';
  import IconButton from './controls/IconButton.svelte';
  import Menu from './controls/Menu.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { appState } from './app-state.svelte';
  import { collectAsset, relinkAsset } from './project-actions';
  import {
    ASSET_DRAG_MIME,
    buildPoolItems,
    clipsUsingAsset,
    groupPool,
    insertAssetClip,
    type PoolItem,
    type PoolKind,
  } from './media-pool';
  import { resolveImageAsset } from '../typography/image-assets';
  import { ensureVideoThumb, forgetVideoThumb, videoThumb } from './media-thumbs.svelte';
  import { fmtSize } from './export';
  import { snapTime } from '../core/time';
  import type { IconName } from './icons';
  import type { MessageKey } from '../i18n/locales';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    /**
     * 条目的落点由宿主决定：不传 = 时间轴（插到播放头，媒体池抽屉那条路）；
     * 排版编辑页传自己的实现（图片置入画布，视频/音频给一句说明）。
     * 「双击」与右侧的 + 按钮共用它。
     */
    oninsert?: (item: PoolItem) => void;
  }
  const { oninsert }: Props = $props();

  /* 落点不同，提示语跟着换：在排版页说「插入到时间轴」是错的。 */
  const insertLabel = $derived(oninsert ? tr('pool.placeOnCanvas') : tr('pool.insert'));
  const hint = $derived(oninsert ? tr('pool.hintTypo') : tr('pool.hint'));

  const GROUP_LABEL: Record<PoolKind, MessageKey> = {
    video: 'pool.groupVideo',
    image: 'pool.groupImage',
    audio: 'pool.groupAudio',
  };
  const GROUP_ICON: Record<PoolKind, IconName> = {
    video: 'video',
    image: 'image',
    audio: 'audio-lines',
  };

  /**
   * 列表跟着 `appState.version` 走：导入素材是「先 put 字节、再 commit」，
   * 而 version 是 commit 推的 —— 读version 才能让新导进来的那条立刻出现。
   * 切工程也走它（`subscribeActive` 会把 version 换成新工程的计数）。
   */
  const items = $derived.by(() => {
    void appState.version;
    return buildPoolItems(appState.store.project.assets, appState.assets);
  });
  const groups = $derived(groupPool(items));

  /**
   * 视频缩略图：**惰性**解一帧（图片那边导入时就解好了，见 media-thumbs）。
   * 放 `$effect` 而不是在 `items` 的派生里做 —— 派生必须保持纯的，
   * 而 `ensureVideoThumb` 有副作用（排队解码）。它内部幂等，重复调用无代价。
   */
  $effect(() => {
    for (const it of items) if (it.kind === 'video') ensureVideoThumb(it.id);
  });

  /**
   * 元信息一行：尺寸 / 时长 / 体积。
   *
   * 用 `·` 连起来而不是拼句子 —— 这三段都是**纯数值格式化**（`1920×1080`
   * 与 `12.3s` 一样不进语言文件），拼接也不影响语序。
   */
  function metaOf(it: PoolItem): string {
    const parts: string[] = [];
    if (it.size) parts.push(`${it.size.w}×${it.size.h}`);
    if (it.durationSec !== null) parts.push(`${it.durationSec.toFixed(1)}s`);
    if (it.bytes !== null) parts.push(fmtSize(it.bytes));
    return parts.join(' · ');
  }

  function insert(it: PoolItem): void {
    // 宿主接管了落点（排版页）：交给它，这一层不认识那种落点的规则。
    if (oninsert) {
      oninsert(it);
      return;
    }
    const grid = appState.store.project.beatGrid;
    const selected = appState.selectedClipId;
    const clipId = insertAssetClip(appState.store, it, {
      at: snapTime(appState.playT, appState.snap, grid),
      grid,
      preferredTrackId: selected ? (appState.store.findClip(selected)?.track.id ?? null) : null,
    });
    // 缺字节的条目按钮是禁用的，正常走不到这里；真到了也不该静默。
    if (!clipId) {
      appState.flash(tr('pool.missing'), 'error');
      return;
    }
    appState.selectedClipId = clipId;
  }

  /**
   * 把这条素材挂到拖拽的 `DataTransfer` 上（落点在时间轴的轨道行里）。
   *
   * 只带 **id**：拖拽期间工程可能被改（撤销、删除），落地时按 id 重新解析成
   * `PoolItem`，拿到的一定是当下的事实。
   */
  function dragStart(e: DragEvent, it: PoolItem): void {
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = 'copy';
    dt.setData(ASSET_DRAG_MIME, it.id);
    // 兜底：拖到文本框、别的应用里至少留下名字
    dt.setData('text/plain', it.name);
  }

  /* ------------------------------------------------------------ 移除素材 */

  /** ⋯ 菜单开在哪个条目上（非 null 时渲染菜单）。只用于**渲染**。 */
  let menuFor = $state<{ item: PoolItem; anchor: HTMLElement } | null>(null);
  /**
   * 菜单当前作用的条目。**普通变量，不是 $state** —— 这是刻意的：
   * `Menu.activate()` 是「先 `onclose()` 再跑 `onselect()`」（见 controls/Menu.svelte），
   * 那时 `menuFor` 已经是 null。闭包里读 `menuFor.item`（或模板里用 `{@const}`
   * 从它派生）都会在那一刻抛 TypeError —— 表现是「点菜单项什么都不发生」。
   */
  let menuTarget: PoolItem | null = null;
  /**
   * 待确认的移除。**引用数在按下那一刻算一次**并存在这里 ——
   * 弹窗期间工程还能被改（另一只手在拖片段），实时重算会让文案在用户眼皮底下跳。
   */
  let pendingDelete = $state<{ item: PoolItem; used: number } | null>(null);

  function askDelete(it: PoolItem): void {
    pendingDelete = { item: it, used: clipsUsingAsset(appState.store.project, it.id).length };
  }

  function confirmDelete(): void {
    const p = pendingDelete;
    pendingDelete = null;
    if (!p) return;
    appState.removeAsset(p.item.id);
    // 缩略图缓存是 UI 层的（`media-thumbs`），跟着这一行一起丢掉 ——
    // objectURL 不 revoke 就一直钉着那份字节。
    forgetVideoThumb(p.item.id);
    appState.flash(tr('pool.deleted', { name: p.item.name }), 'success');
  }</script>

<div class="pool">
  {#if !items.length}
    <div class="empty" data-testid="pool-empty">
      <Icon name="images" size={22} />
      <p>{tr('pool.empty')}</p>
      <p class="hint">{tr('pool.emptyHint')}</p>
    </div>
  {:else}
    {#each groups as g (g.kind)}
      <!-- 分组容器带 kind：测试与将来的拖放都要能一眼认出「这是哪一组」。 -->
      <section class="group" data-testid="pool-group" data-kind={g.kind}>
        <h3 class="group-head">
          <Icon name={GROUP_ICON[g.kind]} size={12} />
          <span>{tr(GROUP_LABEL[g.kind])}</span>
          <span class="count" data-testid="pool-group-count">{g.items.length}</span>
        </h3>

        {#each g.items as it (it.id)}
          <!--
            缩略图：图片是导入时解好的 objectURL；视频要**惰性解一帧**
            （`media-thumbs` 排队解码，就绪后 version 一变这里自动重渲）；
            音频没有画面，用类型图标。
          -->
          {@const thumb = it.kind === 'image'
            ? resolveImageAsset(it.id)
            : it.kind === 'video'
              ? videoThumb(it.id)
              : null}
          <!--
            双击 = 插入，拖 = 拖到时间轴上落成片段。行本身不是按钮（它没有
            自己的动作），所以用 role="presentation" 挂交互，真正的动作在右侧那个 + 上。
          -->
          <div
            class="row"
            class:missing={it.missing}
            role="presentation"
            draggable={!it.missing}
            data-testid="pool-item"
            data-asset-id={it.id}
            data-kind={it.kind}
            ondragstart={(e) => dragStart(e, it)}
            ondblclick={() => insert(it)}
          >
            <span class="thumb">
              {#if thumb}
                <img src={thumb} alt="" loading="lazy" data-testid="pool-thumb" />
              {:else}
                <Icon name={GROUP_ICON[it.kind]} size={15} />
              {/if}
            </span>

            <span class="text">
              <span class="name" title={it.name} data-testid="pool-name">{it.name}</span>
              <span class="sub">
                {#if it.missing}
                  <span class="warn">{tr('pool.missing')}</span>
                {/if}
                {#if it.linked}
                  <span class="badge" title={tr('pool.linkedHint')} data-testid="pool-linked">
                    {tr('pool.linked')}
                  </span>
                {/if}
                {#if metaOf(it)}<span>{metaOf(it)}</span>{/if}
              </span>
            </span>

            <IconButton
              icon="plus"
              label={insertLabel}
              size="sm"
              testid="pool-insert"
              disabled={it.missing}
              onclick={() => insert(it)}
            />

            <!--
              ⋯ 与轨道行、时间轴片段用同一套菜单位置与图标：这一列的动作都是
              「对这条东西做点什么」，放在行的右端、图标一致，用户不用重新找。
            -->
            <IconButton
              icon="ellipsis-vertical"
              label={tr('pool.menu')}
              size="sm"
              testid="pool-menu"
              onclick={(e) => {
                menuTarget = it;
                menuFor = { item: it, anchor: e.currentTarget as HTMLElement };
              }}
            />
          </div>
        {/each}
      </section>
    {/each}

    <p class="foot">{hint}</p>
  {/if}
</div>

{#if menuFor}
  <Menu
    items={[
      ...(menuTarget?.linked
        ? [
            {
              id: 'collect',
              label: tr('pool.collect'),
              icon: 'hard-drive' as const,
              testid: 'pool-menu-collect',
              onselect: () => {
                if (menuTarget) void collectAsset(menuTarget.id);
              },
            },
            {
              id: 'relink',
              label: tr('pool.relink'),
              icon: 'link' as const,
              testid: 'pool-menu-relink',
              onselect: () => {
                if (menuTarget) void relinkAsset(menuTarget.id);
              },
            },
          ]
        : []),
      {
        id: 'delete',
        label: tr('pool.delete'),
        icon: 'trash' as const,
        danger: true,
        testid: 'pool-menu-delete',
        // 读 `menuTarget`（普通变量），**不是** `menuFor`：理由见它的声明。
        onselect: () => menuTarget && askDelete(menuTarget),
      },
    ]}
    anchorEl={menuFor.anchor}
    onclose={() => (menuFor = null)}
    testid="pool-menu-panel"
  />
{/if}

{#if pendingDelete}
  <ConfirmDialog
    title={tr('pool.deleteTitle')}
    message={pendingDelete.used > 0
      ? tr('pool.deleteUsedMessage', { name: pendingDelete.item.name, n: pendingDelete.used })
      : tr('pool.deleteMessage', { name: pendingDelete.item.name })}
    confirmLabel={tr('pool.deleteConfirm')}
    danger
    testid="confirm-delete-asset"
    onconfirm={confirmDelete}
    oncancel={() => (pendingDelete = null)}
  />
{/if}

<style>
  .pool {
    padding: var(--sp-3) 0 var(--sp-4);
  }

  .group + .group {
    margin-top: var(--sp-4);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin: 0 0 var(--sp-2);
    padding: 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  /* 计数贴右：三组之间一眼看出「哪一类素材最多」 */
  .count {
    margin-left: auto;
    color: var(--text-disabled);
    letter-spacing: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-4);
    cursor: default;
  }
  .row:hover {
    background: var(--surface-hover);
  }
  /* 可拖的条目给一个抓手光标（缺字节的那条不给：它拖不动） */
  .row[draggable='true'] {
    cursor: grab;
  }
  .row.missing .name {
    color: var(--text-muted);
    text-decoration: line-through;
  }

  /* 缩略图格子：定宽定比，图片与图标两种内容都落在同一块地里 */
  .thumb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 40px;
    height: 26px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--text-muted);
    overflow: hidden;
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    /* contain 而不是 cover：素材的原始比例要看得见（裁过的缩略图会误导） */
    object-fit: contain;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .name {
    color: var(--text-primary);
    font-size: var(--fs-sm);
    /* 长文件名不许把「+」按钮挤出抽屉 */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: flex;
    gap: var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    white-space: nowrap;
  }
  .warn {
    color: var(--danger);
  }

  .foot {
    margin: var(--sp-4) var(--sp-4) 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-6) var(--sp-4);
    color: var(--text-muted);
    text-align: center;
  }
  .empty p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .empty .hint {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
</style>
