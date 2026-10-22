/**
 * session.ts — 一轮对话的**工具循环**。
 *
 * 职责边界：
 *
 *   provider       发请求 / 解析 SSE
 *   **session**    消息历史、工具循环、事务、取消、上下文裁剪、图片注入
 *   executor       工具名 → 控制平面调用
 *   ui/agent/*     展示事件、输入框、审批对话框
 *
 * ## 一轮 = 一笔撤销
 *
 * 每次 `send()` 用 `beginTx` / `endTx` 包住整轮。`CommandStack.commit` 在事务
 * 内不再单独入栈（见 `core/commands.ts`），所以用户按一次 Ctrl+Z 就能撤掉
 * agent 这一轮的全部改动 —— 而不是逐条退。
 *
 * ## 图片注入
 *
 * Chat Completions 只允许图片出现在 `user` 消息里。工具结果（`role:'tool'`）
 * 只能带文本，所以截图在**本轮工具都执行完**之后，合成一条 user 消息追加：
 * `[{type:'text', text:'Rendered frame ...'}, {type:'image_url', ...}]`。
 * 下一轮模型就能看到它。这也顺带避免了「工具结果里夹图片」在其它兼容服务上
 * 直接 400。
 *
 * ## 停止
 *
 * `AbortController` 贯穿网络请求；工具执行本身不可中断（控制平面是同步的），
 * 但循环会在每个工具之后检查 `aborted` 并收尾。事务仍然提交 —— 已经发生的
 * 改动留在工程里，用户可以撤销。
 */

import { tr } from '../../i18n/index.svelte';
import type { AgentControlPlane } from '../control-plane';
import type { ControlResult } from '../types';
import { AGENT_TOOLS, TOOL_BY_NAME, type ToolSpec } from '../tools';
import { SUMMARY_SYSTEM, SYSTEM_PROMPT, summaryRequest } from './prompt';
import { LLM_TIMEOUT_MS, streamChat } from './transport';
import { parseToolArguments } from './tool-args';
import { contextLimitOf, supportsImages } from './providers/registry';
import type { ToolExecutor } from './executor';
import {
  LlmError,
  type AgentStatus,
  type LlmConfig,
  type LlmUsage,
  type SessionEvent,
  type ToolOutcome,
  type WireMessage,
  type WirePart,
  type WireToolCall,
} from './types';

/**
 * 单轮最多几次「模型 → 工具」往返。
 *
 * 早先的 16 步在真实任务里根本不够（一个排版 + 截图 + 修错就二三十步）。
 * 现在默认 200、上限 2000 —— 真正的刹车不是步数，而是 `stop()`、**重复调用
 * 的引导**（见 `REPEAT_WARN`）与服务端错误。
 */
export const MAX_STEPS = 200;
export const MAX_STEPS_LIMIT = 2000;
/** 上下文里保留的消息字符预算（粗算，中文按 1 字 ≈ 1 token）。 */
/**
 * 默认上下文窗口（token）。**只是兜底**：真正生效的值来自
 * `providers/registry.ts::contextLimitOf(config)` —— 各家的窗口从 32k 到 1M
 * 不等，写死一个数会让压缩永不触发（然后在跑到一半时 400）。
 *
 * 这是**估算**：真实用量以服务端返回的 `usage.prompt_tokens` 为准，只有它缺席
 * （例如压缩后的第一轮）才回落到「字符数 / 2.5」。
 */
export const CONTEXT_LIMIT_TOKENS = 1_000_000;
export const COMPACT_AT = 0.75;
/** 压缩时保留的最近消息条数（从 user 边界切，绝不拆开 assistant/tool 对）。 */
const KEEP_RECENT_MESSAGES = 8;
/** 兜底硬裁剪（字符）。1M token ≈ 2.5M 字符；压缩失效时才会走到这里。 */
export const MAX_CONTEXT_CHARS = 2_400_000;

/** 上下文是否该压缩（纯函数）。 */
export function shouldCompact(tokens: number, limit = CONTEXT_LIMIT_TOKENS): boolean {
  return tokens >= limit * COMPACT_AT;
}

/** 字符 → token 的粗估（中文约 1 字/token，英文约 4 字符/token）。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}
/**
 * 同一个「工具 + 参数」重复到这些次数时的处理阶梯。
 *
 * 以前第 3 次直接抛错掐断 —— 但模型常常是在**确认它刚做过的事**（或读同一个
 * 只读场景），并不是死循环，用户却只看到「失败」。现在：
 *   3 次 → 注入一条提示（换参数 / 读结果 / 用 ask_user），**继续干活**；
 *   6 次 → 再提示一次，更明确；
 *   12 次 → 才真的判定卡死并停下（此时确实没有进展）。
 */
const REPEAT_WARN = 3;
const REPEAT_WARN_AGAIN = 6;
const REPEAT_HARD = 12;

/**
 * 「同一组参数」不等于「同一个问题」的工具。
 *
 * `render_frame` / `frame_signature` 的入参只有 t 与 size —— 工程在这两次调用
 * 之间被改过时，重新渲一次恰恰是**正确**的动作。判据因此带上场景版本
 * （`control.sceneVersion()`：内容版本 + 播放头），工程变了就重新计数。
 */
const SCENE_SENSITIVE_TOOLS = new Set(['render_frame', 'frame_signature']);

/** 重复调用的判据键（纯函数，单测覆盖）。场景敏感的工具带上版本。 */
export function repeatKeyOf(
  name: string,
  argsJson: string,
  scene?: { version: number; playT: number } | null,
): string {
  const base = `${name}:${argsJson}`;
  if (!scene || !SCENE_SENSITIVE_TOOLS.has(name)) return base;
  return `${base}@${scene.version}:${scene.playT}`;
}

/** 第 n 次重复同一个「工具 + 参数」时该做什么（纯函数，单测覆盖）。 */
/** 控制平面结果 → 工具结果。与 `executor` 的包装同形，避免回环里再造一份。 */
function outcomeOf<T>(r: ControlResult<T>): ToolOutcome {
  return r.ok
    ? { ok: true, text: JSON.stringify({ ok: true, data: r.data }) }
    : {
        ok: false,
        code: r.error.code,
        detail: r.error.detail,
        text: JSON.stringify({ ok: false, error: r.error }),
      };
}

export type RepeatAction = 'none' | 'hint' | 'stop';

export function repeatAction(n: number): RepeatAction {
  if (n >= REPEAT_HARD) return 'stop';
  if (n === REPEAT_WARN || n === REPEAT_WARN_AGAIN) return 'hint';
  return 'none';
}

export interface SessionOptions {
  config: LlmConfig;
  control: AgentControlPlane;
  execute: ToolExecutor;
  onEvent(e: SessionEvent): void;
  onStatus(s: AgentStatus): void;
  /**
   * 需要用户确认的动作（插件试挂 / 安装）。返回 true = 已批准。
   *
   * `kind` 区分两种语义：`try` 会**立刻执行**源码（载入内存 + 真 GL 编译校验），
   * `install` 才会写盘。面板按它切换文案与「本次会话允许试挂」。
   *
   * 由面板实现：弹一张卡，用户点了才 resolve(true)。session 拿到 true 之后
   * 自己带 `confirm:true` 再调一次控制平面 —— UI 不直接改状态。
   */
  onApproval?(req: {
    kind: 'try' | 'install';
    pluginId: string;
    detail?: unknown;
    text: string;
  }): Promise<boolean>;
  /**
   * 模型调用 `ask_user` 时由面板弹一张问答卡，回答直接作为工具结果回给模型。
   * 返回 `null` = 用户取消（工具结果里写 cancelled）。
   */
  onAskUser?(req: { question: string; options: string[]; allowFreeText: boolean }): Promise<string | null>;
  /**
   * 每轮是否允许把截图注入对话。默认 true。
   *
   * 关掉时工具**照常渲染**（用户仍能在面板上看到缩略图），只是模型看不到画面，
   * 只能靠 `frame_signature` 判断 —— 这正是设置里那个开关的语义。
   */
  screenshots?(): boolean;
  /** 单轮最多几次「模型 → 工具」往返。给函数则每轮重新读（设置里改了立刻生效）。 */
  maxSteps?: number | (() => number);
}

export interface SessionSnapshot {
  messages: WireMessage[];
  status: AgentStatus;
  usage: LlmUsage | null;
}

function messageChars(m: WireMessage): number {
  let n = m.reasoning_content?.length ?? 0;
  if (typeof m.content === 'string') n += m.content.length;
  else if (Array.isArray(m.content)) {
    n += m.content.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 2_500), 0);
  }
  for (const call of m.tool_calls ?? []) n += call.function.name.length + call.function.arguments.length;
  return n;
}

export function estimateMessagesTokens(messages: WireMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += messageChars(m);
  return Math.ceil(chars / 2.5);
}

/**
 * 压缩前保留的「最近一段」：从倒数第 N 条开始，**往前**挪到 user 边界。
 * 直接切在 assistant/tool 之间会留下孤立的 `tool_call_id`（服务端 400）。
 */
export function recentTail(messages: WireMessage[], keep = KEEP_RECENT_MESSAGES): WireMessage[] {
  if (messages.length <= keep + 1) return [];
  let start = messages.length - keep;
  for (let i = start; i >= 1; i--) {
    if (messages[i]!.role === 'user') {
      start = i;
      break;
    }
  }
  // 没找到 user 边界就不保留尾巴（宁可全摘要，也不要半截工具对）。
  if (messages[start]?.role !== 'user') return [];
  return messages.slice(start);
}

/** 给总结模型看的转录：每条截断，避免「压缩请求本身爆上下文」。 */
function transcriptOf(messages: WireMessage[]): string {
  const lines: string[] = [];
  for (const m of messages.slice(1)) {
    let body = '';
    if (typeof m.content === 'string') body = m.content;
    else if (Array.isArray(m.content)) {
      body = m.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n');
    }
    if (m.tool_calls?.length) {
      body += `\n[tool calls] ${m.tool_calls
        .map((c) => `${c.function.name}(${c.function.arguments.slice(0, 400)})`)
        .join(', ')}`;
    }
    if (m.tool_call_id) body = `[tool ${m.tool_call_id}] ${body}`;
    lines.push(`${m.role}: ${body.slice(0, 2000)}`);
  }
  const text = lines.join('\n\n');
  // 总结请求自己也不能无限长：取尾部（最近的上下文更重要）。
  return text.length > 240_000 ? text.slice(-240_000) : text;
}

/**
 * 上下文裁剪：保留 system，从最近往前累加，超出预算时在**一条 user 消息处**
 * 切开（切在 assistant/tool 之间会留下孤立的 `tool_call_id`，服务端会 400）。
 */
export function trimMessages(messages: WireMessage[], budget = MAX_CONTEXT_CHARS): WireMessage[] {
  if (messages.length <= 2) return messages;
  let total = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 1; i--) {
    total += messageChars(messages[i]!);
    if (total > budget) break;
    cut = i;
  }
  // 没有裁掉任何东西（cut 落在第一条业务消息上）就原样返回。
  if (cut >= messages.length || cut <= 1) return messages;
  // 往前挪到最近的 user 边界（含它）。
  for (let i = cut; i >= 1; i--) {
    if (messages[i]!.role === 'user') {
      return [messages[0]!, ...messages.slice(i)];
    }
  }
  // 前面没有 user：往后找**下一条** user，绝不从 tool / assistant 中间切开
  // （那会留下孤立的 tool_call_id，服务端直接 400）。
  for (let i = cut; i < messages.length; i++) {
    if (messages[i]!.role === 'user') return [messages[0]!, ...messages.slice(i)];
  }
  return messages;
}

/** 工具表里 `writes:true` 的工具名集合（计数用）。 */
const WRITE_TOOLS = new Set(
  Array.from(TOOL_BY_NAME.values())
    .filter((t: ToolSpec) => t.writes)
    .map((t) => t.name),
);

export class AgentSession {
  private messages: WireMessage[];
  private status: AgentStatus = 'idle';
  private abort: AbortController | null = null;
  private usage: LlmUsage | null = null;
  private busy = false;
  /** 上下文用量（token）。优先用服务端 usage，缺席时按字符估算。 */
  private contextTokens = 0;
  /** 最近一次失败（导出日志时带出去，便于排查 400）。 */
  lastError: { code: string; message: string; status?: number; detail?: string } | null = null;
  /** 「这个模型收不了图片」只提示一次，别每轮刷屏。 */
  private warnedImages = false;

  constructor(private readonly opts: SessionOptions) {
    // 思考强度走原生参数（见 provider 的 thinkingParams），系统提示不随档位变。
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  }

  /* ------------------------------------------------------------- 查询 */

  snapshot(): SessionSnapshot {
    return { messages: [...this.messages], status: this.status, usage: this.usage };
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get context(): { tokens: number; limit: number } {
    return { tokens: this.contextTokens, limit: this.limit() };
  }

  /** 当前 (provider, model) 的上下文窗口。切换模型后立刻生效。 */
  private limit(): number {
    return contextLimitOf(this.opts.config);
  }

  private emitContext(): void {
    this.opts.onEvent({ kind: 'context', tokens: this.contextTokens, limit: this.limit() });
  }

  clear(): void {
    if (this.busy) this.stop();
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    this.usage = null;
    this.contextTokens = 0;
    this.lastError = null;
    this.warnedImages = false;
    this.emitContext();
    this.setStatus('idle');
  }

  stop(): void {
    this.abort?.abort();
  }

  private setStatus(s: AgentStatus): void {
    this.status = s;
    this.opts.onStatus(s);
  }

  /**
   * 这个 (provider, model) 收不收图片。
   *
   * 不判断的后果不是报错，而是**模型凭空描述画面** —— 它看不到图，却会顺着
   * 上下文里「我截图了」的说法编一段出来。所以能力判定必须在注册表里，
   * 而不是「反正发了也没事」。
   */
  private imagesAllowed(): boolean {
    if (supportsImages(this.opts.config)) return true;
    if (!this.warnedImages) {
      this.warnedImages = true;
      this.opts.onEvent({ kind: 'notice', text: tr('agent.llm.noImages') });
    }
    return false;
  }

  /* ------------------------------------------------------------- 一轮 */

  /**
   * 75% 时把前半段对话压成一份交接说明（同一个模型、不带工具）。
   * 失败不致命：继续用原上下文跑，下一轮再试。
   */
  private async maybeCompact(signal: AbortSignal): Promise<void> {
    if (!shouldCompact(this.contextTokens, this.limit())) return;
    if (this.messages.length <= KEEP_RECENT_MESSAGES + 1) return;

    const before = this.contextTokens;
    try {
      const res = await streamChat(
        this.opts.config,
        [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user', content: summaryRequest(transcriptOf(this.messages)) },
        ],
        // 不带 tools：总结请求不需要工具，也不会被 reasoning_content 回传规则约束。
        undefined,
        signal,
        {},
      );
      const summary = res.content.trim();
      if (!summary) return;
      const tail = recentTail(this.messages);
      // 找不到安全的尾巴就不压缩：宁可超一点上下文，也不要丢掉当前这一步。
      if (!tail.length) return;
      this.messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `# Handoff note from the earlier part of this session\n${summary}\n` +
            '(This is a summary produced for you; the original messages were dropped to save context.)',
        },
        ...tail,
      ];
      this.contextTokens = estimateMessagesTokens(this.messages);
      this.opts.onEvent({
        kind: 'notice',
        text: tr('agent.context.compacted', {
          from: Math.round(before / 1000),
          to: Math.round(this.contextTokens / 1000),
        }),
      });
      this.emitContext();
    } catch (e) {
      if (e instanceof LlmError && e.code === 'cancelled') throw e;
      // 压缩失败不阻断主流程（例如总结请求被限流）。
    }
  }

  async send(text: string, images: { base64: string; mimeType: string }[] = []): Promise<void> {
    const content = text.trim();
    if (!content && !images.length) return;
    if (this.busy) {
      this.opts.onEvent({ kind: 'error', message: tr('agent.llm.busy'), code: 'busy' });
      return;
    }

    this.busy = true;
    this.lastError = null;
    const startedAt = Date.now();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    let writes = 0;

    // 系统提示是常量；思考强度由请求体里的 thinking / reasoning_effort 决定。
    this.messages[0] = { role: 'system', content: SYSTEM_PROMPT };

    if (images.length) {
      const keep = this.imagesAllowed();
      const parts: WirePart[] = [
        {
          type: 'text',
          text: keep
            ? content
            : `${content}\n\n[the user attached ${images.length} image(s); this model cannot read images]`.trim(),
        },
        ...(keep
          ? images.map<WirePart>((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: 'low' },
            }))
          : []),
      ];
      this.messages.push({ role: 'user', content: parts });
    } else {
      this.messages.push({ role: 'user', content });
    }
    this.opts.onEvent({ kind: 'user', text: content, ...(images.length ? { images } : {}) });

    // 整轮包一笔撤销。失败（例如已经有事务开着）不致命：退回逐笔撤销。
    await this.opts.control.beginTx();

    try {
      this.setStatus('thinking');
      const tools = AGENT_TOOLS;
      const repeat = new Map<string, number>();
      const configured = this.opts.maxSteps ?? MAX_STEPS;
      const maxSteps = Math.max(1, typeof configured === 'function' ? configured() : configured);

      for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) throw new LlmError('cancelled', tr('agent.llm.cancelled'));

        await this.maybeCompact(signal);
        const trimmed = trimMessages(this.messages);
        if (trimmed.length !== this.messages.length) this.messages = trimmed;

        let streamed = '';
        const result = await streamChat(this.opts.config, this.messages, tools, signal, {
          onText: (d) => {
            streamed += d;
            this.opts.onEvent({ kind: 'assistant', text: d });
          },
          onReasoning: (d) => this.opts.onEvent({ kind: 'reasoning', text: d }),
        });
        if (result.usage) this.usage = result.usage;
        // usage 是服务端的真实计数；没有时按字符估算（压缩后的第一轮就是这种）。
        if (result.usage?.prompt_tokens) {
          this.contextTokens = result.usage.prompt_tokens + (result.usage.completion_tokens ?? 0);
        } else {
          this.contextTokens = estimateMessagesTokens(this.messages);
        }
        this.emitContext();

        const assistant: WireMessage = {
          role: 'assistant',
          content: result.content || (streamed ? streamed : null),
          /*
           * 思维链**文本**。存下来是必须的：DeepSeek 带 `tools` 时每一轮都要
           * 回传（漏传 = 400）。至于发不发出去，由适配器按 provider 的
           * `thinking.echo` 决定 —— session 不在这个层面做任何 provider 判断。
           */
          reasoning_content: result.reasoning,
          ...(result.toolCalls.length
            ? {
                tool_calls: result.toolCalls.map<WireToolCall>((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.arguments || '{}' },
                })),
              }
            : {}),
          /*
           * 内部字段：Anthropic 的 thinking/redacted_thinking 原始块、OpenRouter 的
           * `reasoning_details`。**不能上线** —— 序列化器会剥掉它。
           * 带 `providerId` 是为了切家之后不再把别家的推理回传过去。
           */
          providerMeta: {
            providerId: this.opts.config.providerId,
            ...(result.reasoningRaw ? { reasoning: result.reasoningRaw } : {}),
          },
        };
        this.messages.push(assistant);

        if (!result.toolCalls.length) break;
        if (signal.aborted) throw new LlmError('cancelled', tr('agent.llm.cancelled'));
        this.setStatus('tool');

        const images: { base64: string; mimeType: string; caption: string }[] = [];

        for (const call of result.toolCalls) {
          const spec = TOOL_BY_NAME.get(call.name);
          const callId = call.id;
          let args: Record<string, unknown> = {};
          if (!spec) {
            const out: ToolOutcome = {
              ok: false,
              code: 'not-found',
              text: JSON.stringify({ ok: false, error: { code: 'not-found', message: tr('agent.llm.toolUnknown', { name: call.name }) } }),
            };
            this.pushToolResult(callId, out);
            this.opts.onEvent({ kind: 'tool', callId, name: call.name, args: {}, status: 'error', code: 'not-found', text: out.text });
            continue;
          }
          try {
            args = parseToolArguments(call);
          } catch (e) {
            const out: ToolOutcome = {
              ok: false,
              code: 'invalid-argument',
              text: JSON.stringify({
                ok: false,
                error: {
                  code: 'invalid-argument',
                  message: tr('agent.llm.toolArgs', { name: call.name, detail: e instanceof Error ? e.message : String(e) }),
                },
              }),
            };
            this.pushToolResult(callId, out);
            this.opts.onEvent({ kind: 'tool', callId, name: call.name, args: {}, status: 'error', code: 'invalid-argument', text: out.text });
            continue;
          }

          /*
           * `ask_user` 不经过控制平面：它要的不是工程数据，而是**一个人**。
           * 回答直接作为 tool result 回给模型；面板同时收到一张问答卡。
           */
          if (call.name === 'ask_user') {
            const askStart = Date.now();
            const question = typeof args.question === 'string' ? args.question.trim() : '';
            const options = Array.isArray(args.options)
              ? args.options.filter((x): x is string => typeof x === 'string').slice(0, 6)
              : [];
            const allowFreeText = args.allowFreeText !== false;
            let out: ToolOutcome;
            if (!question || !this.opts.onAskUser) {
              out = {
                ok: false,
                code: 'unsupported',
                text: JSON.stringify({
                  ok: false,
                  error: { code: 'unsupported', message: 'ask_user is not available in this client' },
                }),
              };
            } else {
              this.setStatus('awaiting-user');
              this.opts.onEvent({ kind: 'ask', question, options, allowFreeText });
              const answer = await this.opts.onAskUser({ question, options, allowFreeText });
              this.setStatus('tool');
              out =
                answer === null
                  ? {
                      ok: false,
                      code: 'cancelled',
                      text: JSON.stringify({ ok: false, error: { code: 'cancelled', message: 'user cancelled' } }),
                    }
                  : { ok: true, text: JSON.stringify({ ok: true, data: { answer } }) };
            }
            this.pushToolResult(callId, out);
            this.opts.onEvent({
              kind: 'tool',
              callId,
              name: 'ask_user',
              args: { question },
              status: out.ok ? 'ok' : 'error',
              ...(out.code ? { code: out.code } : {}),
              text: out.text,
              ms: Date.now() - askStart,
            });
            continue;
          }

          /*
           * 重复调用的处理阶梯（见 REPEAT_WARN 的注释）：先**引导**，不掐断。
           *
           * ⚠️ 引导**不能**作为 system 消息插到 assistant/tool 之间 —— DeepSeek 在
           * 带 tools 的请求上会因此 400（实测：第 3 次提示后整轮失败，且历史被污染，
           * 之后每一条消息都 400）。改成**附加在这条 tool 结果后面**：结构不变，
           * 模型照样读得到。
           */
          let scene: { version: number; playT: number } | null = null;
          if (SCENE_SENSITIVE_TOOLS.has(call.name)) {
            const v = await this.opts.control.sceneVersion();
            if (v.ok) scene = v.data;
          }
          const key = repeatKeyOf(call.name, call.arguments, scene);
          const n = (repeat.get(key) ?? 0) + 1;
          repeat.set(key, n);
          const repeatStep = repeatAction(n);
          let guidance: string | null = null;
          if (repeatStep === 'hint') {
            guidance =
              `\n\n[system note] You have called \`${call.name}\` with identical arguments ${n} times. ` +
              'Read the result above again. If it already answered the question, continue with the ' +
              'next step; if it failed, change the arguments or the approach; if you are blocked by ' +
              'an ambiguity in the user request, call `ask_user`. Do not repeat it again.';
            this.opts.onEvent({
              kind: 'notice',
              text: tr('agent.llm.loopNotice', { name: call.name, n }),
            });
          }
          if (repeatStep === 'stop') {
            throw new LlmError('bad-response', tr('agent.llm.loop', { n }));
          }

          this.opts.onEvent({ kind: 'tool', callId, name: call.name, args, status: 'running' });
          const startedAt = Date.now();
          let out = await this.opts.execute(call.name, args);

          /*
           * 需要审批：交给面板。用户点了之后 session 带 `confirm:true` 再调一次
           * 控制平面 —— 面板不直接改状态。
           *
           * 两条路径（W0.4）：
           *  · `plugin_try` 会**立刻执行**源码，批准后用同一份参数重试；
           *  · `plugin_install` 只写盘，批准后按 pluginId 安装。
           * 工具面不暴露 `confirm`（模型不能自己批准），所以这一层必须按名字分流。
           */
          if (!out.ok && out.code === 'needs-approval' && this.opts.onApproval) {
            this.setStatus('awaiting-approval');
            const detail = out.detail as { pluginId?: unknown; kind?: unknown } | undefined;
            const pluginId = String(detail?.pluginId ?? args.pluginId ?? '');
            const kind: 'try' | 'install' =
              call.name === 'plugin_try' || detail?.kind === 'try' ? 'try' : 'install';
            const approved = await this.opts.onApproval({
              kind,
              pluginId,
              detail: out.detail,
              text: out.text,
            });
            this.setStatus('tool');
            if (approved && kind === 'try') {
              out = outcomeOf(
                await this.opts.control.pluginTry({
                  id: String(args.id ?? pluginId),
                  name: String(args.name ?? ''),
                  source: String(args.source ?? ''),
                  confirm: true,
                }),
              );
            } else if (approved && pluginId) {
              out = outcomeOf(await this.opts.control.pluginInstall(pluginId, true));
            }
          }

          if (guidance) out = { ...out, text: `${out.text}${guidance}` };
          if (out.ok && WRITE_TOOLS.has(call.name)) writes += 1;
          this.pushToolResult(callId, out);
          this.opts.onEvent({
            kind: 'tool',
            callId,
            name: call.name,
            args,
            status: out.ok ? 'ok' : 'error',
            ...(out.code ? { code: out.code } : {}),
            text: out.text,
            ms: Date.now() - startedAt,
          });
          if (out.images?.length) images.push(...out.images);
          if (signal.aborted) break;
        }

        // 截图统一在**工具轮之后**注入成一条 user 消息（见文件头）。
        // 设置里关掉「截图回传」时只留在面板上，不进模型的上下文。
        if (images.length) {
          if ((this.opts.screenshots?.() ?? true) && this.imagesAllowed()) {
            const parts: WirePart[] = [
              { type: 'text', text: images.map((i) => i.caption).join('\n') || 'Rendered frame.' },
              ...images.map<WirePart>((i) => ({
                type: 'image_url',
                image_url: { url: `data:${i.mimeType};base64,${i.base64}`, detail: 'low' },
              })),
            ];
            this.messages.push({ role: 'user', content: parts });
          }
          for (const img of images) {
            this.opts.onEvent({ kind: 'image', base64: img.base64, mimeType: img.mimeType, caption: img.caption });
          }
        }

        if (signal.aborted) throw new LlmError('cancelled', tr('agent.llm.cancelled'));
        if (step === maxSteps - 1) {
          throw new LlmError('bad-response', tr('agent.llm.maxSteps', { n: maxSteps }));
        }
      }
    } catch (e) {
      this.lastError =
        e instanceof LlmError
          ? { code: e.code, message: e.message, status: e.status, detail: e.detail }
          : { code: 'internal', message: e instanceof Error ? e.message : String(e) };

      /*
       * 400 之后**必须换掉上下文**：坏消息（缺 reasoning_content、孤立 tool 等）
       * 会一直留在历史里，导致之后每一条消息都 400。清掉模型历史，UI 记录保留。
       * 这不是「静默吞错」——下面仍会报错，同时给一条可读的提示。
       */
      if (e instanceof LlmError && e.code === 'context') {
        /*
         * 上下文超限**绝不能走下面那条「清空历史」**：那是为了逃离被污染的
         * 历史，而这里只是装不下。把用量顶到窗口上，下一轮开头的 `maybeCompact`
         * 就会触发压缩。
         */
        this.contextTokens = Math.max(this.contextTokens, this.limit());
        this.emitContext();
        this.opts.onEvent({ kind: 'notice', text: tr('agent.llm.contextOverflow') });
      } else if (e instanceof LlmError && e.code === 'bad-response' && e.status === 400) {
        this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
        this.contextTokens = 0;
        this.emitContext();
        this.opts.onEvent({ kind: 'notice', text: tr('agent.llm.resetOn400') });
      }

      this.opts.onEvent({ kind: 'error', message: describeError(e), code: e instanceof LlmError ? e.code : 'internal' });
    } finally {
      try {
        await this.opts.control.endTx('agent: turn');
      } catch {
        /* endTx 失败（事务没开成）不掩盖真正的错误 */
      }
      this.busy = false;
      this.abort = null;
      this.opts.onEvent({ kind: 'turn-end', writes, ms: Date.now() - startedAt });
      this.setStatus('idle');
    }
  }

  private pushToolResult(callId: string, out: ToolOutcome): void {
    this.messages.push({ role: 'tool', tool_call_id: callId, content: out.text });
  }
}

function describeError(e: unknown): string {
  if (e instanceof LlmError) {
    switch (e.code) {
      case 'no-key':
        return tr('agent.llm.noKey');
      case 'auth':
        return tr('agent.llm.auth');
      case 'balance':
        return tr('agent.llm.balance');
      case 'rate-limit':
        return tr('agent.llm.rate');
      case 'network':
        return tr('agent.llm.network', { detail: e.detail ?? e.message });
      case 'timeout':
        return tr('agent.llm.timeout', { ms: LLM_TIMEOUT_MS });
      case 'cancelled':
        return tr('agent.llm.cancelled');
      case 'transport':
        return tr('agent.llm.transport', { detail: e.detail ?? e.message });
      case 'context':
        return tr('agent.llm.context');
      case 'unsupported':
        return tr('agent.llm.unsupported', { detail: e.message });
      case 'bad-response':
        // HTTP 400 的响应体是排查的唯一线索（reasoning_content / 工具配对），
        // 别把它吞成一句「HTTP 400」。
        return e.status
          ? tr('agent.llm.http', { status: e.status, detail: (e.detail ?? e.message).slice(0, 500) })
          : e.message || tr('agent.llm.badResponse');
      default:
        return tr('agent.llm.http', { status: e.status ?? 0, detail: e.detail ?? e.message });
    }
  }
  return e instanceof Error ? e.message : String(e);
}
