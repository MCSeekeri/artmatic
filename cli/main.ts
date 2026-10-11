/**
 * main.ts — Artmatic 的**工程文件工具**（方案 `docs/agent-control-plane.md` §7）。
 *
 * ## 定位：这不是「编辑器 CLI」，更不是「渲染器 CLI」
 *
 * 它只碰 `project.json`。**永远不出像素** —— `render` 子命令只是**驱动器**：
 * 它 build → 起 preview → 起 Chrome → 让页面里的控制平面导出（见
 * `mcp/render-driver.mjs`）。任何「在 Node 里直接出像素」的尝试都违反硬约束
 * 1.1：那会变成第二条求值路径，表现是「预览对了、导出不对，而且不报错」。
 *
 * ## 为什么它仍然有价值
 *
 * - 能进 CI：`validate` 挡住坏工程（改坏一份 `project.json` 不该等到打开才发现）；
 * - 能被 shell 脚本批量处理；
 * - 让「用 git 管理 `project.json`」这条工作流闭环（`diff` 给的是**语义**差异，
 *   不是 JSON 文本差异 —— 片段顺序、缩进、键序都不该算作改动）。
 *
 * ## 为什么不写「第二套片段几何」
 *
 * 编辑全部走 `ProjectStore` —— 与界面同一条路径。`core/clips.ts` 里 trim-in /
 * push / trim 那套时序是这个项目里最容易写错的东西（AGENTS §4.3 整节都在讲它），
 * 在 CLI 里再实现一遍等价于「同一件事有两个真相」，而且是那个没人测的真相。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectStore } from '../src/core/project-store';
import { SCHEMA_VERSION, defaultProject, migrateProject, newId, type AnyClip, type Project } from '../src/core/schema';

/* ------------------------------------------------------------------ 输出 */

const out = (msg: string) => process.stdout.write(`${msg}\n`);
/**
 * 失败即退出（CLI 没有「继续跑」的语义）。
 *
 * 写成**函数声明**而不是 `const` 箭头：只有前者能让 TS 做「never 返回 ⇒ 后面
 * 不可达」的控制流分析（这样 `let raw; try { raw = … } catch { fail() }` 之后
 * 用 `raw` 才不会被报 "used before being assigned"）。
 */
function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------ 参数解析 */

interface Args {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq >= 0) {
        flags[key.slice(0, eq)] = key.slice(eq + 1);
        continue;
      }
      // `--flag value` 与 `--flag`（布尔）都支持：下一个词以 `-` 开头就算布尔。
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function numberFlag(flags: Record<string, string>, name: string, fallback?: number): number {
  const raw = flags[name];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    fail(`缺少 --${name}`);
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) fail(`--${name} 不是数字：${raw}`);
  return v;
}

function parseResolution(raw: string): { w: number; h: number } {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(raw.trim());
  if (!m) fail(`--resolution 形如 1920x1080，收到 ${raw}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

/* ------------------------------------------------------- 读 / 写工程 */

const PROJECT_FILE = 'project.json';
const BAK_FILE = 'project.json.bak';

function projectPath(dir: string): string {
  return join(dir, PROJECT_FILE);
}

/** 读工程：先迁移（`migrateProject` 内含校验）。坏工程直接退出 1。 */
function readProject(dir: string): { project: Project; fromVersion: number } {
  const path = projectPath(dir);
  if (!existsSync(path)) fail(`「${dir}」里没有 ${PROJECT_FILE}`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    fail(`${path} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  const fromVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : -1;
  try {
    return { project: migrateProject(raw), fromVersion };
  } catch (e) {
    fail(`工程校验失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 写工程。**先留 `.bak`、再写临时文件、最后 rename**。
 *
 * 与浏览器侧（`project/io.ts` 的原子写）同一个形状：Node 有 `rename`，
 * 于是「写到一半崩掉留下半份工程」是可以避免的 —— 而不留 `.bak` 的话，
 * 一次误操作就再也没有回退点了。
 */
function writeProject(dir: string, project: Project): void {
  const path = projectPath(dir);
  const body = `${JSON.stringify(project, null, 2)}\n`;
  if (existsSync(path)) {
    try {
      writeFileSync(join(dir, BAK_FILE), readFileSync(path));
    } catch {
      /* 上一版存不下来不该拦住这次保存 */
    }
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

/** 改工程：走 `ProjectStore`（与界面同一条路径），有变化才落盘。 */
function editProject(dir: string, fn: (store: ProjectStore) => void): boolean {
  const { project } = readProject(dir);
  const store = new ProjectStore(project);
  const before = JSON.stringify(store.project);
  fn(store);
  if (JSON.stringify(store.project) === before) return false;
  writeProject(dir, store.project);
  return true;
}

/* ------------------------------------------------------------- new */

function cmdNew(args: Args): void {
  const dir = args.positional[0] ?? fail('用法：new <dir> [--name N] [--fps F] [--duration S] [--resolution WxH]');
  const project = defaultProject(args.flags.name ?? '未命名工程');
  project.fps = numberFlag(args.flags, 'fps', project.fps);
  project.duration = numberFlag(args.flags, 'duration', project.duration);
  if (args.flags.resolution) project.resolution = parseResolution(args.flags.resolution);
  // 空白工程的轨道不能是空的：没有轨的话右键菜单出不来、片段也没地方放 ——
  // 那不是「空白」，那是「坏了」（`core/demo-project.ts` 的同一句话）。
  project.tracks = [
    { kind: 'visual', id: newId(), name: 'V1', enabled: true, clips: [] },
    { kind: 'audio', id: newId(), name: 'A1', enabled: true, clips: [], bus: 'master' },
  ];
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(projectPath(dir))) fail(`「${dir}」里已经有 ${PROJECT_FILE}（不覆盖）`);
  writeProject(dir, project);
  out(`已创建 ${projectPath(dir)}`);
  out(`  轨道 ${project.tracks.length} 条 · ${project.resolution.w}×${project.resolution.h} @ ${project.fps}fps · ${project.duration}s`);
}

/* -------------------------------------------------------- validate */

function cmdValidate(args: Args): void {
  const dir = args.positional[0] ?? fail('用法：validate <dir>');
  const { project, fromVersion } = readProject(dir);
  const clips = project.tracks.reduce((n, t) => n + t.clips.length, 0);
  out(`✓ 合法：${project.name}`);
  out(`  schemaVersion ${fromVersion} → ${project.schemaVersion}（当前支持 ${SCHEMA_VERSION}）`);
  if (fromVersion !== project.schemaVersion) out('  ⚠️ 已迁移，磁盘上的文件还是旧版本（跑一次编辑命令或 clip 命令会写回）');
  out(`  ${project.tracks.length} 轨 · ${clips} 个片段 · ${project.resolution.w}×${project.resolution.h} @ ${project.fps}fps · ${project.duration}s`);
  out(`  重叠策略 ${project.overlapBehavior} · 拍网格 ${project.beatGrid.bpm}bpm/${project.beatGrid.beatsPerBar}`);
}

/* ------------------------------------------------------------- clip */

function cmdClip(args: Args): void {
  const verb = args.positional[0] ?? fail('用法：clip add|rm|mv|split …');
  const dir = args.positional[1] ?? fail('用法：clip <verb> <dir> …');

  switch (verb) {
    case 'add': {
      const trackId = args.positional[2] ?? fail('用法：clip add <dir> <trackId> <start> <end> [--generator id | --color #hex]');
      const start = Number(args.positional[3]);
      const end = Number(args.positional[4]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) fail('start / end 必须是秒');
      const generator = args.flags.generator;
      const color = args.flags.color;
      if (!generator && !color) fail('要给 --generator（算法生成器）或 --color（纯色）');
      const changed = editProject(dir, (store) => {
        const clip: AnyClip = {
          kind: 'source',
          id: args.flags.id ?? newId(),
          start,
          end,
          label: args.flags.label ?? generator ?? color ?? 'clip',
          fadeSec: 0,
          curves: {},
          source: generator
            ? { type: 'algo', generator, params: {} }
            : { type: 'solid', color: color! },
          blend: 'normal',
          opacity: 1,
          transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
          fit: 'contain',
        };
        store.addClip(trackId, clip);
      });
      out(changed ? '✓ 已加入片段' : '（落点被占且找不到空档，工程未改动）');
      return;
    }
    case 'rm': {
      const clipId = args.positional[2] ?? fail('用法：clip rm <dir> <clipId>');
      const changed = editProject(dir, (store) => store.removeClip(clipId));
      out(changed ? '✓ 已删除片段' : '（找不到这个片段，工程未改动）');
      return;
    }
    case 'mv': {
      const clipId = args.positional[2] ?? fail('用法：clip mv <dir> <clipId> [--to trackId] [--start S]');
      const changed = editProject(dir, (store) => {
        const found = store.findClip(clipId);
        if (!found) return;
        const to = args.flags.to ?? found.track.id;
        const start = args.flags.start !== undefined ? Number(args.flags.start) : found.clip.start;
        // `liveMoveClip` 不入栈（它是手势的实时阶段），CLI 里一次移动就是最终状态，
        // 所以还要 `settlePlacement` 按重叠策略结算 —— 与 `agent` 的 move_clip 同构。
        store.commit('cli: 移动片段', () => {
          store.liveMoveClip(to, clipId, start);
          store.settlePlacement(to, clipId, start);
        });
      });
      out(changed ? '✓ 已移动片段' : '（没有可落的位置，工程未改动）');
      return;
    }
    case 'split': {
      const clipId = args.positional[2] ?? fail('用法：clip split <dir> <clipId> <at>');
      const at = Number(args.positional[3]);
      if (!Number.isFinite(at)) fail('at 必须是秒');
      const changed = editProject(dir, (store) => {
        const found = store.findClip(clipId);
        if (!found) return;
        store.splitClipAt(found.track.id, clipId, at);
      });
      out(changed ? '✓ 已切分' : '（切点落在片段之外，工程未改动）');
      return;
    }
    default:
      fail(`未知的 clip 子命令 ${verb}（可用：add / rm / mv / split）`);
  }
}

/* ------------------------------------------------------------- diff */

interface Diff {
  changes: string[];
}

/**
 * 语义差异。
 *
 * 为什么不做 JSON 文本 diff：片段在数组里的顺序、对象的键序、缩进都不影响
 * 画面，而它们会让文本 diff 一片红。CI 里要挡的是「有人悄悄把某段挪了 0.5 秒」
 * 这类**语义**改动，所以按 id 对齐、逐字段比。
 */
function semanticDiff(a: Project, b: Project, labelA: string, labelB: string): Diff {
  const changes: string[] = [];
  const scalar = (name: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) changes.push(`${name}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  };
  scalar('name', a.name, b.name);
  scalar('fps', a.fps, b.fps);
  scalar('duration', a.duration, b.duration);
  scalar('resolution', a.resolution, b.resolution);
  scalar('beatGrid', a.beatGrid, b.beatGrid);
  scalar('overlapBehavior', a.overlapBehavior, b.overlapBehavior);
  scalar('seed', a.seed, b.seed);

  const clipsOf = (p: Project) => new Map(p.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  const ca = clipsOf(a);
  const cb = clipsOf(b);
  for (const [id, clip] of ca) {
    const other = cb.get(id);
    if (!other) {
      changes.push(`片段 ${id}（${clip.label}）只在 ${labelA}`);
      continue;
    }
    if (clip.start !== other.start || clip.end !== other.end) {
      changes.push(`片段 ${id}（${clip.label}）区间 ${clip.start}–${clip.end} → ${other.start}–${other.end}`);
    }
    if (JSON.stringify(clip.curves) !== JSON.stringify(other.curves)) changes.push(`片段 ${id} 的关键帧变了`);
    if (clip.kind === 'source' && other.kind === 'source') {
      if (JSON.stringify(clip.source) !== JSON.stringify(other.source)) changes.push(`片段 ${id} 的来源 / 参数变了`);
      if (clip.blend !== other.blend) changes.push(`片段 ${id} 混合模式 ${clip.blend} → ${other.blend}`);
      if (clip.opacity !== other.opacity) changes.push(`片段 ${id} 不透明度 ${clip.opacity} → ${other.opacity}`);
      if (JSON.stringify(clip.transform) !== JSON.stringify(other.transform)) changes.push(`片段 ${id} 的变换变了`);
      if (JSON.stringify(clip.transitionOut) !== JSON.stringify(other.transitionOut)) {
        changes.push(`片段 ${id} 的出画转场变了`);
      }
    }
    if (clip.kind === 'effect' && other.kind === 'effect') {
      if (clip.chain.map((c) => c.defId).join() !== other.chain.map((c) => c.defId).join()) {
        changes.push(`片段 ${id} 的特效链顺序变了`);
      }
      if (JSON.stringify(clip.chain) !== JSON.stringify(other.chain)) changes.push(`片段 ${id} 的特效参数变了`);
    }
  }
  for (const [id, clip] of cb) {
    if (!ca.has(id)) changes.push(`片段 ${id}（${clip.label}）只在 ${labelB}`);
  }

  const ta = new Map(a.tracks.map((t) => [t.id, t]));
  const tb = new Map(b.tracks.map((t) => [t.id, t]));
  for (const [id, t] of ta) {
    const other = tb.get(id);
    if (!other) {
      changes.push(`轨道 ${id}（${t.name}）只在 ${labelA}`);
      continue;
    }
    if (t.name !== other.name) changes.push(`轨道 ${id} 名字 ${t.name} → ${other.name}`);
    if (t.enabled !== other.enabled) changes.push(`轨道 ${id}（${t.name}）开关 ${t.enabled} → ${other.enabled}`);
  }
  for (const [id, t] of tb) if (!ta.has(id)) changes.push(`轨道 ${id}（${t.name}）只在 ${labelB}`);

  // 轨道顺序是**合成顺序**（tracks[0] 最前景），所以顺序变了必须报。
  const orderA = a.tracks.map((t) => t.id).join();
  const orderB = b.tracks.map((t) => t.id).join();
  if (orderA !== orderB) changes.push('轨道顺序变了（= 合成层序变了）');
  return { changes };
}

function cmdDiff(args: Args): void {
  const a = args.positional[0] ?? fail('用法：diff <dirA> <dirB>');
  const b = args.positional[1] ?? fail('用法：diff <dirA> <dirB>');
  const pa = readProject(a).project;
  const pb = readProject(b).project;
  const { changes } = semanticDiff(pa, pb, a, b);
  if (changes.length === 0) {
    out('✓ 语义上完全相同');
    return;
  }
  for (const line of changes) out(`• ${line}`);
  out(`共 ${changes.length} 处语义差异`);
  // 退出码 1 = 有差异：CI 里 `artmatic diff a b || echo 变了` 就能用。
  process.exit(1);
}

/* ------------------------------------------------------------- help */

function printHelp(): void {
  out('Artmatic 工程文件工具（CLI）');
  out('');
  out('  new <dir>             生成一份空白工程（project.json）');
  out('      --name N --fps F --duration S --resolution WxH');
  out('  validate <dir>        校验 + 迁移报告（CI 用它挡坏工程）');
  out('  clip add <dir> <trackId> <start> <end>  [--generator id | --color #hex] [--id X] [--label L]');
  out('  clip rm <dir> <clipId>');
  out('  clip mv <dir> <clipId> [--to trackId] [--start S]');
  out('  clip split <dir> <clipId> <at>');
  out('  diff <a> <b>          语义差异（有差异时退出码 1）');
  out('  render <dir> --out FILE [--format mp4|png|gif] [--range from:to] [--size WxH]');
  out('');
  out('  ⚠️ 本 CLI **永不渲染**：render 只是驱动器，像素由浏览器里的控制平面出。');
}

/* ------------------------------------------------------------- 入口 */

export function runCli(argv: string[]): void {
  const args = parseArgs(argv);
  const cmd = args.positional.shift();
  switch (cmd) {
    case 'new':
      return cmdNew(args);
    case 'validate':
      return cmdValidate(args);
    case 'clip':
      // clip 的动词在 positional 的最前面，`cmdClip` 自己再看一层。
      return cmdClip({ positional: args.positional, flags: args.flags });
    case 'diff':
      return cmdDiff(args);
    case undefined:
    case 'help':
    case '--help':
      return printHelp();
    default:
      fail(`未知命令 ${cmd}（跑 help 看用法）`);
  }
}
