<script lang="ts">
  /**
   * AgentDrawer — 左侧的对话抽屉（与媒体池同一列、互斥）。
   *
   * 视觉纪律：零阴影零渐变；层次靠 surface-0→3 + 1px 实线；字号 10/11/12。
   *
   * 四个不显然的约束：
   *  1. **输入框是浮在底部的**（`position: absolute`），不是流里的最后一块：
   *     对话很长时它不该被推走。代价是消息区要自己留出底部内边距 —— 用
   *     `bind:clientHeight` 量真实高度，附件 / 多行输入长高时不会盖住最后一条。
   *  2. **消息列表里的子项禁止收缩**：flex column 默认 `flex-shrink:1` 会把
   *     消息互相压扁，滚动条永远不出现（`.stream > *` 与工具卡各自都钉死）。
   *  3. **自动跟随用 sticky 开关**，不能用 scrollTop 现算：内容从不满一屏长到
   *     溢出时 scrollTop 还是 0，会被误判成「用户翻上去了」。
   *  4. **设置与历史都在根级**：抽屉是带 z-index 的层叠上下文，modal 挂进来会被
   *     右侧检查器盖住遮罩。
   */
  import Icon from '../Icon.svelte';
  import IconButton from '../controls/IconButton.svelte';
  import Button from '../controls/Button.svelte';
  import ToolCallCard from './ToolCallCard.svelte';
  import PluginApprovalCard from './PluginApprovalCard.svelte';
  import AskUserCard from './AskUserCard.svelte';
  import ReasoningBlock from './ReasoningBlock.svelte';
  import { agentState, type AgentEffort } from './agent-state.svelte';
  import { appState } from '../app-state.svelte';
  import { DENSITY } from '../tokens';
  import { tr } from '../../i18n/index.svelte';

  let input = $state('');
  let preview = $state<{ src: string; caption: string } | null>(null);
  let scroller: HTMLDivElement | null = null;
  let textarea: HTMLTextAreaElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let composerH = $state(96);
  let menuOpen = $state(false);
  let menuEl = $state<HTMLDivElement | null>(null);

  interface Attachment {
    name: string;
    mimeType: string;
    base64: string;
    url: string;
  }
  let attachments = $state<Attachment[]>([]);

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  /** 可切换的模型（也允许在设置里填任意兼容服务的模型名）。 */
  const MODELS = ['deepseek-flash', 'deepseek-chat'];

  const EFFORTS: { id: AgentEffort; key: 'agent.effort.off' | 'agent.effort.low' | 'agent.effort.high' | 'agent.effort.max' }[] = [
    { id: 'off', key: 'agent.effort.off' },
    { id: 'low', key: 'agent.effort.low' },
    { id: 'high', key: 'agent.effort.high' },
    { id: 'max', key: 'agent.effort.max' },
  ];

  /* ------------------------------------------------------------- 发送 */

  const canSend = $derived(
    !agentState.busy && (input.trim().length > 0 || attachments.length > 0),
  );

  function send(): void {
    const text = input.trim();
    if ((!text && !attachments.length) || agentState.busy) return;
    const images = attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }));
    input = '';
    attachments = [];
    if (textarea) textarea.style.height = '';
    void agentState.send(text, images);
  }

  function onKeydown(e: KeyboardEvent): void {
    // 中文输入法正在组词时按 Enter 是「选词」，不是发送。
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape' && agentState.busy) {
      e.preventDefault();
      agentState.stop();
    }
  }

  function autosize(e: Event): void {
    const el = e.currentTarget as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }

  function fill(text: string): void {
    input = text;
    textarea?.focus();
  }

  function retry(): void {
    for (let i = agentState.messages.length - 1; i >= 0; i--) {
      const m = agentState.messages[i];
      if (m?.role === 'user') {
        void agentState.send(m.text);
        return;
      }
    }
  }

  /* ------------------------------------------------------------- 附图 */

  function pickFiles(): void {
    fileInput?.click();
  }

  async function addFiles(files: FileList | null): Promise<void> {
    for (const file of Array.from(files ?? [])) {
      if (!file.type.startsWith('image/')) continue;
      if (attachments.length >= MAX_IMAGES) {
        appState.flash(tr('agent.imageLimit', { n: MAX_IMAGES }));
        break;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        appState.flash(tr('agent.imageTooLarge', { mb: 5 }), 'error');
        continue;
      }
      const url = await readAsDataUrl(file);
      const base64 = url.slice(url.indexOf(',') + 1);
      attachments = [
        ...attachments,
        { name: file.name, mimeType: file.type || 'image/png', base64, url },
      ];
    }
    if (fileInput) fileInput.value = '';
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment(i: number): void {
    attachments = attachments.filter((_, idx) => idx !== i);
  }

  /* ------------------------------------------------------------ 下拉菜单 */

  $effect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent): void => {
      if (menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  /* ------------------------------------------------------- 右键菜单 */

  /**
   * 自绘右键菜单（原生菜单由 App 的全局 contextmenu 统一禁掉，输入框除外）。
   * 面板里的正文 / 工具结果是**可选中**的：这里只补「复制 / 全选 / 添加到输入框」，
   * 因为浏览器自己的菜单在这一页是被禁的，没有它就只能 Ctrl+C。
   */
  let ctxMenu = $state<{ x: number; y: number; text: string } | null>(null);

  function onContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    // 输入框保留原生菜单（复制 / 粘贴 / 拼写检查是系统能力）。
    if (target?.closest('textarea, input')) return;
    e.preventDefault();
    ctxMenu = { x: e.clientX, y: e.clientY, text: window.getSelection()?.toString() ?? '' };
  }

  $effect(() => {
    if (!ctxMenu) return;
    const close = (ev: PointerEvent): void => {
      if (!(ev.target as HTMLElement | null)?.closest('.ctx-menu')) ctxMenu = null;
    };
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') ctxMenu = null;
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onEsc, true);
    };
  });

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      appState.flash(tr('agent.copied'));
    } catch {
      appState.flash(tr('agent.copyFailed'), 'error');
    }
    ctxMenu = null;
  }

  function selectStream(): void {
    const el = scroller;
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    ctxMenu = null;
  }

  function addSelectionToInput(): void {
    const text = ctxMenu?.text.trim();
    if (text) {
      input = input ? `${input}\n${text}` : text;
      textarea?.focus();
    }
    ctxMenu = null;
  }

  function copyConversation(): void {
    const text = agentState.messages
      .map((m) => {
        if (m.role === 'tool') return `[${m.toolName ?? 'tool'}] ${m.text}`;
        if (m.role === 'image') return `[image] ${m.text}`;
        return `${m.role}: ${m.text}`;
      })
      .join('\n\n');
    void copyText(text);
  }

  const ctxX = $derived(ctxMenu ? Math.min(ctxMenu.x, window.innerWidth - 190) : 0);
  const ctxY = $derived(ctxMenu ? Math.min(ctxMenu.y, window.innerHeight - 130) : 0);

  /* ------------------------------------------------------- 上下文环形 */

  const CTX_R = 6;
  const CTX_C = 2 * Math.PI * CTX_R;
  const ctxPct = $derived(
    Math.min(100, Math.round((agentState.context.tokens / Math.max(1, agentState.context.limit)) * 100)),
  );
  const ctxDash = $derived(CTX_C * (1 - ctxPct / 100));
  const ctxTone = $derived(ctxPct >= 90 ? 'danger' : ctxPct >= 75 ? 'warn' : 'idle');
  const ctxTitle = $derived(
    tr('agent.context.ring', {
      pct: ctxPct,
      used: fmtTokens(agentState.context.tokens),
      limit: fmtTokens(agentState.context.limit),
    }),
  );

  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  /* ------------------------------------------------------------- 滚动 */

  let stick = $state(true);

  function onScroll(): void {
    const el = scroller;
    if (!el) return;
    stick = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  $effect(() => {
    // 依赖条数 + 最后一条文本 / 思考长度；贴底才跟随（用户往上翻时不抢滚动条）。
    const n = agentState.messages.length;
    const tail = agentState.messages[n - 1];
    const tailLen = tail ? tail.text.length : 0;
    void n;
    void tailLen;
    if (n === 0) stick = true;
    const el = scroller;
    if (!el) return;
    if (stick) el.scrollTop = el.scrollHeight;
  });

  /* ------------------------------------------------------------- 拖宽 */

  let resizing = $state(false);
  let dragStartX = 0;
  let dragStartW = 0;

  function startResize(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    resizing = true;
    dragStartX = e.clientX;
    dragStartW = appState.mediaPoolWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent): void => {
      appState.setMediaPoolWidth(dragStartW + (ev.clientX - dragStartX));
    };
    const up = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      resizing = false;
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /* ------------------------------------------------------------- 渲染 */

  /** 极简 markdown：只切代码块（插件源码是整段 ```js）。 */
  function segments(text: string): { code: boolean; text: string }[] {
    const out: { code: boolean; text: string }[] = [];
    const re = /```[a-zA-Z0-9]*\n([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ code: false, text: text.slice(last, m.index) });
      out.push({ code: true, text: m[1] ?? '' });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ code: false, text: text.slice(last) });
    return out.length ? out : [{ code: false, text }];
  }

  const statusText = $derived.by(() => {
    switch (agentState.status) {
      case 'thinking':
        return tr('agent.status.thinking');
      case 'tool':
        return tr('agent.status.tool');
      case 'awaiting-approval':
        return tr('agent.status.approval');
      case 'awaiting-user':
        return tr('agent.status.awaitingUser');
      case 'error':
        return tr('agent.status.error');
      default:
        return '';
    }
  });

  const effortKey = $derived(
    EFFORTS.find((e) => e.id === agentState.prefs.effort)?.key ?? 'agent.effort.high',
  );
  const totalTokens = $derived(
    agentState.usage ? agentState.usage.prompt + agentState.usage.completion : 0,
  );
</script>

<aside
  class="agent-drawer"
  class:resizing
  class:preview-open={!!preview}
  data-testid="agent-drawer"
  data-busy={agentState.busy}
  style:width={`${appState.mediaPoolWidth}px`}
  style:min-width={`${DENSITY.poolMinW}px`}
  oncontextmenu={onContextMenu}
>
  <div
    class="drawer-resize"
    role="separator"
    aria-label={tr('pool.resizeWidth')}
    aria-orientation="vertical"
    data-testid="agent-drawer-resize"
    onpointerdown={startResize}
  ></div>

  <div class="drawer-head">
    <span class="drawer-title" title={tr('agent.railTip')}>
      <Icon name="sparkles" size={12} />
      {tr('agent.title')}
    </span>
    <span class="head-actions">
      <IconButton
        icon="message-circle-plus"
        label={tr('agent.newChat')}
        size="sm"
        testid="agent-clear"
        onclick={() => agentState.clear()}
      />
      <IconButton
        icon="history"
        label={tr('agent.history')}
        tipText={tr('agent.historyTip')}
        size="sm"
        testid="agent-history"
        active={agentState.historyOpen}
        onclick={() => agentState.openHistory()}
      />
      <IconButton
        icon="download"
        label={tr('agent.exportLog')}
        tipText={tr('agent.exportLogTip')}
        size="sm"
        testid="agent-export-log"
        onclick={() => agentState.exportLog()}
      />
      <IconButton
        icon="settings"
        label={tr('agent.settings')}
        size="sm"
        active={agentState.settingsOpen}
        testid="agent-settings"
        onclick={() => agentState.openSettings()}
      />
      <IconButton
        icon="x"
        label={tr('agent.collapse')}
        size="sm"
        testid="agent-drawer-toggle"
        onclick={() => {
          agentState.closeSettings();
          appState.setAgentOpen(false);
        }}
      />
    </span>
  </div>

  <div
    class="stream"
    bind:this={scroller}
    data-testid="agent-stream"
    onscroll={onScroll}
    style:padding-bottom={`${composerH + 16}px`}
  >
    {#if agentState.messages.length === 0}
      <div class="empty">
        <div class="empty-title">{tr('agent.emptyTitle')}</div>
        <p class="hint">{tr('agent.emptyHint')}</p>
        {#if !agentState.ready}
          <Button
            label={tr('agent.emptyKeyCta')}
            variant="outline"
            testid="agent-open-settings"
            onclick={() => agentState.openSettings()}
          />
        {:else}
          <div class="suggestions">
            <button type="button" class="chip" onclick={() => fill(tr('agent.suggest.effect'))}>
              {tr('agent.suggest.effect')}
            </button>
            <button type="button" class="chip" onclick={() => fill(tr('agent.suggest.typography'))}>
              {tr('agent.suggest.typography')}
            </button>
            <button type="button" class="chip" onclick={() => fill(tr('agent.suggest.plugin'))}>
              {tr('agent.suggest.plugin')}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#each agentState.messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <div class="msg user" data-testid="agent-msg-user">
          {#if msg.images?.length}
            <div class="user-images">
              {#each msg.images as img, i (i)}
                <img
                  src={`data:${img.mimeType};base64,${img.base64}`}
                  alt={tr('agent.attachImage')}
                />
              {/each}
            </div>
          {/if}
          {#if msg.text}
            <div class="bubble">{msg.text}</div>
          {/if}
        </div>
      {:else if msg.role === 'assistant'}
        <div class="msg assistant" data-testid="agent-msg-assistant">
          {#each segments(msg.text) as seg}
            {#if seg.code}
              <pre class="code">{seg.text}</pre>
            {:else}
              <div class="text">{seg.text}</div>
            {/if}
          {/each}
        </div>
      {:else if msg.role === 'reasoning'}
        <ReasoningBlock text={msg.text} />
      {:else if msg.role === 'tool'}
        <ToolCallCard {msg} />
      {:else if msg.role === 'ask'}
        <AskUserCard {msg} />
      {:else if msg.role === 'notice'}
        <div class="notice" data-testid="agent-notice">{msg.text}</div>
      {:else if msg.role === 'image'}
        <button
          type="button"
          class="shot"
          data-testid="agent-image"
          onclick={() => preview = { src: `data:${msg.image?.mimeType};base64,${msg.image?.base64}`, caption: msg.text }}
        >
          <img src={`data:${msg.image?.mimeType};base64,${msg.image?.base64}`} alt={msg.text} />
          <span class="shot-cap">{msg.text}</span>
        </button>
      {:else if msg.role === 'error'}
        <div class="error" data-testid="agent-error">
          <span>{msg.text}</span>
          <Button label={tr('agent.retry')} variant="ghost" size="sm" onclick={retry} />
        </div>
      {/if}
    {/each}

    <PluginApprovalCard />

    {#if agentState.busy && agentState.messages[agentState.messages.length - 1]?.role !== 'tool'}
      <div class="thinking" data-testid="agent-thinking-indicator">
        <span></span><span></span><span></span>
        <em>{statusText}</em>
      </div>
    {/if}

    {#if !agentState.busy && (totalTokens > 0 || agentState.lastMs > 0)}
      <div class="turn-foot" data-testid="agent-turn-foot">
        <span class="turn-meta">
          {#if totalTokens > 0}{tr('agent.usage', { prompt: agentState.usage?.prompt ?? 0, completion: agentState.usage?.completion ?? 0 })}{/if}
          {#if totalTokens > 0 && agentState.lastMs > 0}<span class="sep">·</span>{/if}
          {#if agentState.lastMs > 0}{tr('agent.turnTime', { s: (agentState.lastMs / 1000).toFixed(1) })}{/if}
          {#if agentState.lastWrites > 0}
            <span class="sep">·</span>{tr('agent.writes', { n: agentState.lastWrites })}
          {/if}
        </span>
        {#if agentState.lastWrites > 0}
          <Button
            label={tr('agent.undoTurn')}
            variant="ghost"
            size="sm"
            testid="agent-undo-turn"
            onclick={() => void agentState.undoTurn()}
          />
        {/if}
      </div>
    {/if}
  </div>

  <!-- 悬浮输入框：绝对定位，消息区用它的真实高度留出底部空间。 -->
  <div class="composer" bind:clientHeight={composerH} data-testid="agent-composer">
    {#if attachments.length}
      <div class="attachments">
        {#each attachments as a, i (a.url)}
          <div class="thumb">
            <img src={a.url} alt={a.name} />
            <button
              type="button"
              class="thumb-x"
              aria-label={tr('agent.removeImage')}
              data-testid="agent-remove-image"
              onclick={() => removeAttachment(i)}
            >
              <Icon name="x" size={10} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if menuOpen}
      <div class="menu" bind:this={menuEl} data-testid="agent-composer-menu">
        <div class="menu-label">{tr('agent.composer.model')}</div>
        {#each MODELS as m (m)}
          <button
            type="button"
            class="menu-item"
            class:active={agentState.prefs.model === m}
            data-testid={`agent-model-option-${m}`}
            onclick={() => {
              agentState.setPrefs({ model: m });
              menuOpen = false;
            }}
          >
            <span class="grow">{m}</span>
            {#if agentState.prefs.model === m}<Icon name="check" size={11} />{/if}
          </button>
        {/each}
        <div class="menu-sep"></div>
        <div class="menu-label">{tr('agent.composer.effort')}</div>
        {#each EFFORTS as e (e.id)}
          <button
            type="button"
            class="menu-item"
            class:active={agentState.prefs.effort === e.id}
            data-testid={`agent-effort-option-${e.id}`}
            onclick={() => {
              agentState.setPrefs({ effort: e.id });
              menuOpen = false;
            }}
          >
            <span class="grow">{tr(e.key)}</span>
            {#if agentState.prefs.effort === e.id}<Icon name="check" size={11} />{/if}
          </button>
        {/each}
      </div>
    {/if}

    <div class="input-box">
      <textarea
        bind:this={textarea}
        bind:value={input}
        rows="2"
        spellcheck="false"
        data-exempt
        data-testid="agent-input"
        placeholder={tr('agent.placeholder')}
        onkeydown={onKeydown}
        oninput={autosize}
      ></textarea>

      <div class="input-foot">
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*"
          multiple
          class="hidden-file"
          data-testid="agent-file-input"
          onchange={(e) => void addFiles((e.currentTarget as HTMLInputElement).files)}
        />
        <IconButton
          icon="image-plus"
          label={tr('agent.attachImage')}
          size="sm"
          testid="agent-attach"
          onclick={pickFiles}
        />
        <button
          type="button"
          class="model-chip"
          data-testid="agent-composer-meta"
          title={tr('agent.composer.more')}
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <span class="model-name">{agentState.prefs.model}</span>
          <span class="sep">·</span>
          <span class="effort">{tr(effortKey)}</span>
          <Icon name="chevron-up" size={10} />
        </button>
        <span class="spacer"></span>
        <!-- 上下文用量：常驻在发送按钮左侧。75% 起琥珀、90% 起红色。 -->
        <span
          class="ctx-ring {ctxTone}"
          title={ctxTitle}
          aria-label={ctxTitle}
          data-testid="agent-context-ring"
          data-pct={ctxPct}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle class="track" cx="8" cy="8" r={CTX_R} />
            <circle
              class="fill"
              cx="8"
              cy="8"
              r={CTX_R}
              stroke-dasharray={CTX_C}
              stroke-dashoffset={ctxDash}
              transform="rotate(-90 8 8)"
            />
          </svg>
        </span>
        {#if agentState.busy}
          <IconButton
            icon="square"
            label={tr('agent.stop')}
            size="sm"
            testid="agent-stop"
            onclick={() => agentState.stop()}
          />
        {:else}
          <IconButton
            icon="send"
            label={tr('agent.send')}
            size="sm"
            testid="agent-send"
            disabled={!canSend}
            onclick={send}
          />
        {/if}
      </div>
    </div>
  </div>
</aside>

{#if preview}
  <button type="button" class="lightbox" onclick={() => (preview = null)} aria-label={tr('agent.image')}>
    <img src={preview.src} alt={preview.caption} />
  </button>
{/if}

{#if ctxMenu}
  <div
    class="ctx-menu"
    data-testid="agent-ctx-menu"
    style:left={`${ctxX}px`}
    style:top={`${ctxY}px`}
  >
    <button
      type="button"
      class="ctx-item"
      data-testid="agent-ctx-copy"
      disabled={!ctxMenu.text}
      onclick={() => void copyText(ctxMenu?.text ?? '')}
    >
      {tr('agent.ctx.copy')}
    </button>
    <button type="button" class="ctx-item" data-testid="agent-ctx-select-all" onclick={selectStream}>
      {tr('agent.ctx.selectAll')}
    </button>
    <button
      type="button"
      class="ctx-item"
      data-testid="agent-ctx-to-input"
      disabled={!ctxMenu.text}
      onclick={addSelectionToInput}
    >
      {tr('agent.ctx.toInput')}
    </button>
    <div class="ctx-sep"></div>
    <button type="button" class="ctx-item" data-testid="agent-ctx-copy-all" onclick={copyConversation}>
      {tr('agent.ctx.copyAll')}
    </button>
  </div>
{/if}

<style>
  .agent-drawer {
    position: relative;
    z-index: var(--z-drawer);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--drawer-bg);
    border-right: 1px solid var(--drawer-border);
    overflow: hidden;
  }
  .agent-drawer.resizing {
    user-select: none;
  }
  /* 截图放大是「全屏浮层」：抽屉自带的 z-index 会被右侧检查器盖住，临时抬到
     modal 之下 —— 只在这一刻抬，平时仍守 z-drawer 的层级。 */
  .agent-drawer.preview-open {
    z-index: calc(var(--z-modal, 150) - 1);
  }
  .drawer-resize {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
    z-index: 1;
  }
  .drawer-resize:hover,
  .resizing .drawer-resize {
    background: var(--accent);
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    flex-shrink: 0;
    height: var(--topbar-h);
    padding: 0 var(--sp-2) 0 var(--sp-4);
    border-bottom: 1px solid var(--drawer-border);
  }
  .drawer-title {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .head-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .stream {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: 10px;
    /* 全局 app.css 把 UI 文本设为不可选；对话内容必须可选（复制 / 右键菜单）。 */
    user-select: text;
    -webkit-user-select: text;
  }
  /* 禁止收缩：否则消息互相压扁、滚动条永远不出现（见文件头第 2 条）。 */
  .stream > * {
    flex: 0 0 auto;
  }

  .empty {
    margin: auto 0;
    padding: var(--sp-3) 0;
  }
  .empty-title {
    margin-bottom: var(--sp-2);
    color: var(--text-primary);
    font-size: var(--fs-md);
    font-weight: 500;
  }
  .suggestions {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin-top: var(--sp-3);
  }
  .chip {
    padding: 6px var(--sp-3);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong, var(--border));
    color: var(--text-primary);
  }

  .msg.user {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .user-images {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    max-width: 88%;
  }
  .user-images img {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .bubble {
    max-width: 88%;
    padding: 6px var(--sp-3);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .msg.assistant {
    color: var(--text-primary);
    font-size: var(--fs-sm);
    line-height: 1.6;
  }
  .msg.assistant .text {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .code {
    margin: 6px 0;
    padding: var(--sp-2);
    max-height: 260px;
    overflow: auto;
    background: var(--surface-0);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-secondary);
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 10px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .notice {
    padding: 2px var(--sp-2);
    border-left: 2px solid var(--warning);
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.5;
  }

  .shot {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    cursor: zoom-in;
  }
  .shot img {
    display: block;
    width: 100%;
    height: auto;
  }
  .shot-cap {
    padding: 3px var(--sp-2);
    background: var(--surface-1);
    color: var(--text-muted);
    font-size: 10px;
    text-align: left;
  }

  .error {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 6px var(--sp-2);
    border: 1px solid var(--border);
    border-left: 2px solid var(--danger);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text-primary);
    font-size: 11px;
    line-height: 1.5;
  }

  .thinking {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: 10px;
  }
  .thinking span {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-muted);
    animation: agent-dot 1s ease-in-out infinite;
  }
  .thinking span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .thinking span:nth-child(3) {
    animation-delay: 0.3s;
  }
  .thinking em {
    margin-left: 4px;
    font-style: normal;
  }
  @keyframes agent-dot {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }

  .turn-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    padding-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }
  .turn-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .sep {
    margin: 0 3px;
  }

  /* --------------------------------------------------------- 悬浮输入框 */
  .composer {
    position: absolute;
    left: var(--sp-2);
    right: var(--sp-2);
    bottom: var(--sp-2);
    z-index: 2;
  }
  .input-box {
    background: var(--surface-1);
    border: 1px solid var(--border-strong, var(--border));
    border-radius: var(--radius-md);
    padding: 6px 6px 4px;
  }
  .input-box:focus-within {
    border-color: var(--accent);
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 40px;
    max-height: 132px;
    padding: 2px var(--sp-2);
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--fs-sm);
    line-height: 1.5;
    resize: none;
  }
  textarea:focus {
    outline: none;
  }
  textarea::placeholder {
    color: var(--text-muted);
  }
  .input-foot {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 2px;
  }
  .hidden-file {
    display: none;
  }
  .model-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 60%;
    padding: 2px var(--sp-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 10px;
    cursor: pointer;
    overflow: hidden;
  }
  .model-chip:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }
  .model-name,
  .effort {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }

  /* 上下文环形：常驻、不占位（16px），颜色只在 75% / 90% 变。 */
  .ctx-ring {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .ctx-ring .track {
    fill: none;
    stroke: var(--border);
    stroke-width: 2;
  }
  .ctx-ring .fill {
    fill: none;
    /* 关键：让弧从 12 点方向开始（配合 rotate(-90)） */
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.3s ease;
  }
  .ctx-ring.warn {
    color: var(--warning);
  }
  .ctx-ring.danger {
    color: var(--danger);
  }

  .ctx-menu {
    position: fixed;
    z-index: var(--z-modal, 150);
    min-width: 168px;
    padding: 3px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    user-select: none;
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 4px var(--sp-3);
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--text-secondary);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .ctx-item:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .ctx-item:disabled {
    color: var(--text-muted);
    opacity: 0.5;
    cursor: default;
  }
  .ctx-sep {
    height: 1px;
    margin: 3px 2px;
    background: var(--border);
  }

  .attachments {
    display: flex;
    gap: 4px;
    padding: 0 2px var(--sp-2);
    overflow-x: auto;
  }
  .thumb {
    position: relative;
    flex-shrink: 0;
  }
  .thumb img {
    display: block;
    width: 48px;
    height: 48px;
    object-fit: cover;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .thumb-x {
    position: absolute;
    top: -5px;
    right: -5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 4px);
    min-width: 190px;
    padding: var(--sp-2);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    z-index: 3;
  }
  .menu-label {
    padding: 2px var(--sp-2);
    color: var(--text-muted);
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 4px var(--sp-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .menu-item.active {
    color: var(--accent);
  }
  .menu-sep {
    height: 1px;
    margin: var(--sp-2) 0;
    background: var(--border);
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 150);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4vh 4vw;
    background: color-mix(in srgb, var(--surface-0) 88%, transparent);
    border: none;
    cursor: zoom-out;
  }
  .lightbox img {
    max-width: 100%;
    max-height: 100%;
    border: 1px solid var(--border);
  }

  @media (prefers-reduced-motion: reduce) {
    .thinking span {
      animation: none;
    }
  }
</style>
