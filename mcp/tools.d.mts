/**
 * tools.d.mts — 给 `tools.mjs` 的类型声明。
 *
 * 网关是**纯 ESM（`.mjs`）**：Node 直接跑 `.ts` 依赖版本相关的类型剥离
 * （本项目 `package.json` 明确不声明 engines），而 MCP 客户端是照着配置直接
 * spawn 这个进程的 —— 那条路上不能有任何「看运气」的环节。
 *
 * 代价是测试（`tests/unit/agent-mcp-tools.test.ts`）import 它时没有类型。
 * 这个文件就是那份类型：手写字面量与 `tools.mjs` 的导出**必须一一对应**，
 * 对不上的表现是 `svelte-check` 报错（跑 `pnpm run check` 就能发现）。
 */

/** 字段类型（与 tools.mjs 的 KINDS 一一对应）。 */
export type FieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'size'
  | 'scalars'
  | 'frameRange'
  | 'curve'
  | 'stringArray'
  | 'any';

export interface FieldSpec {
  kind: FieldKind;
  required?: boolean;
  description?: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
}

export interface ToolSpec {
  name: string;
  /** 只用于文档与统计。 */
  kind: 'read' | 'write' | 'view' | 'export' | 'project';
  description: string;
  args: Record<string, FieldSpec>;
}

export interface McpFailure {
  ok: false;
  error: { code: string; message: string; detail?: unknown };
}

export type Validation = { ok: true; value: Record<string, unknown> } | McpFailure;
export type Check = { ok: true } | McpFailure;

export declare const TOOLS: ToolSpec[];
export declare const TOOL_BY_NAME: Map<string, ToolSpec>;
export declare function fieldSchema(spec: FieldSpec): Record<string, unknown>;
export declare function buildSchema(args: Record<string, FieldSpec>): Record<string, unknown>;
export declare function validateArgs(tool: ToolSpec, raw: unknown): Validation;
export declare function checkIdInList(value: string, list: readonly string[], what: string): Check;
export declare function checkFrameRange(
  range: { from: number; to: number } | undefined,
  totalFrames: number,
): Check;
export declare function listToolDescriptors(): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[];
