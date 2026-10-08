#!/usr/bin/env node
/**
 * 把 Stryker 的 JSON 报告压成「一行一个 survivor」的清单。
 *
 * 为什么需要它：`.stryker-report.json` 是 200KB 级的全量数据，逐条去读等于把
 * 一次改动量的上下文又烧一遍。这里只做四件事 —— 汇总、按 diff 过滤、排序、去重 ——
 * 让人（或模型）读二十行就能决定「哪几条值得动手」。
 *
 * 用法：
 *   node scripts/mutate-triage.mjs                  # 全部 survivor / timeout
 *   node scripts/mutate-triage.mjs --diff HEAD      # 只留本次改动命中的行
 *   node scripts/mutate-triage.mjs --limit 10
 *   node scripts/mutate-triage.mjs --json           # 给上层脚本吃
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);

/** 取 `--k v` 的值；后面没有值（或紧跟另一个 --flag）时回落到 dflt。 */
function opt(name, dflt) {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const next = args[i + 1];
  return next === undefined || next.startsWith('--') ? dflt : next;
}

const REPORT = opt('--report', '.stryker-report.json');
const LIMIT = Number(opt('--limit', '0')) || 0;
const DIFF_REF = args.includes('--diff') ? opt('--diff', 'HEAD') : null;
const AS_JSON = args.includes('--json');

if (!existsSync(REPORT)) {
  console.error(`找不到 ${REPORT} —— 先跑 \`bun run test:mutate\`。`);
  process.exit(2);
}

/**
 * 解析 `git diff -U0 <ref> -- src`，得到「新文件路径 → 本次改动命中的行号集合」。
 * 只关心 src/ 下的源码 —— 测试文件的改动不该把 mutant 拉进视野。
 */
function changedLines(ref) {
  const out = execFileSync('git', ['diff', '--unified=0', ref, '--', 'src'], { encoding: 'utf8' });
  const map = new Map();
  let file = null;
  for (const line of out.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1];
      if (!map.has(file)) map.set(file, new Set());
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      for (let i = 0; i < count; i++) map.get(file).add(start + i);
    }
  }
  return map;
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));

let diff = null;
if (DIFF_REF) {
  try {
    diff = changedLines(DIFF_REF);
  } catch (err) {
    // 已知：某些沙箱里 node 无法 spawn git（EBUSY），bun 可以。降级为不过滤，别让一次探测失败毁掉整个清单。
    console.error(`⚠ git diff 执行失败（${err.code ?? err.message}）。`);
    if (!process.versions.bun) {
      console.error(`  该环境下 node 起不了 git —— 请用 bun 跑：bun scripts/mutate-triage.mjs --diff ${DIFF_REF}`);
    }
    console.error('  本次不过滤，列出全部 survivor。\n');
  }
}

const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
const rows = [];
for (const [path, info] of Object.entries(report.files ?? {})) {
  for (const m of info.mutants ?? []) {
    if (m.status in counts) counts[m.status]++;
    // Killed / NoCoverage 不需要人看 —— 前者已被测试挡住，后者是测试覆盖缺口由别的守卫管。
    if (m.status !== 'Survived' && m.status !== 'Timeout') continue;
    const line = m.location.start.line;
    if (diff && !diff.get(path)?.has(line)) continue;
    rows.push({
      path,
      line,
      col: m.location.start.column,
      status: m.status,
      mutator: m.mutatorName,
      replacement: String(m.replacement ?? '').trim().replace(/\s+/g, ' '),
    });
  }
}
rows.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col);

const total = counts.Killed + counts.Timeout + counts.Survived + counts.NoCoverage;
const score = total ? (((counts.Killed + counts.Timeout) / total) * 100).toFixed(2) : '0.00';
const shown = LIMIT > 0 ? rows.slice(0, LIMIT) : rows;

if (AS_JSON) {
  console.log(JSON.stringify({ score: Number(score), ...counts, filtered: Boolean(diff), matched: rows.length, rows: shown }, null, 2));
} else {
  console.log(
    `score ${score}%   killed ${counts.Killed} / timeout ${counts.Timeout} / ` +
      `survived ${counts.Survived} / no-cov ${counts.NoCoverage}`,
  );
  if (diff) console.log(`已按 ${DIFF_REF} 的改动行过滤，命中 ${rows.length} 条：`);
  for (const r of shown) {
    const tag = r.status === 'Timeout' ? 'TIMEOUT  ' : '';
    console.log(`${r.path}:${r.line}:${r.col}  ${tag}${r.mutator}  ${r.replacement}`);
  }
  if (LIMIT > 0 && rows.length > LIMIT) console.log(`… 另有 ${rows.length - LIMIT} 条（被 --limit 截断）`);
}
