/**
 * gen-api.mjs — 用 TypeDoc 从 `src/core` 与 `src/agent` 生成 Starlight 能吃下的 Markdown。
 *
 * 跑两次而不是一次：两个模块的入口形态不一样 —— `core/` 是 24 个平铺文件
 * （没有桶文件，也不打算为了文档新建一个：那会掉进 stryker 的变异范围），
 * `agent/` 有两个明确的公共桶。一次跑只能选一种 entryPointStrategy。
 *
 * 两处与插件默认行为不同的地方，都是实测逼出来的：
 *   1. frontmatter 自己注入 —— Starlight 的 docsSchema 要求每页有 `title`，
 *      而 TypeDoc 以「模块名 + 导出符号」为页名，不可能给 264 个符号补 `@title`。
 *   2. 文件级注释自己补回 —— TypeDoc 把文件当入口时**不会**把开头那段块注释
 *      挂到模块反射上（`module.comment === undefined`，`module.sources` 也是空的），
 *      于是 `time.ts` 开头「负拍为什么落到第 0 小节」整段消失，而这类注释
 *      恰恰是 API 页里最值钱的部分。
 */
import { Application, ReflectionKind, TSConfigReader, TypeDocReader } from 'typedoc';
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 相对 `site/` 解析。 */
const sitePath = (p) => fileURLToPath(new URL(p, new URL('..', import.meta.url)));
/** TypeDoc 的 entryPoints 走 glob 解析，Windows 的反斜杠会被当成转义符。 */
const posix = (p) =>
  typeof p === 'string' ? p.replace(/\\/g, '/') : { ...p, path: p.path.replace(/\\/g, '/') };

/** 源文件开头的块注释，去掉每行的 ` * ` 前缀。 */
function leadingDoc(file) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const match = src.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  const body = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
  return body || null;
}

/** 插在 frontmatter 之后 —— 放在 `---` 前面会让整个 frontmatter 失效。 */
function insertAfterFrontmatter(contents, block) {
  if (!contents.startsWith('---')) return `${block}\n\n${contents}`;
  const fence = contents.indexOf('\n---', 3);
  if (fence < 0) return `${block}\n\n${contents}`;
  const lineEnd = contents.indexOf('\n', fence + 4);
  if (lineEnd < 0) return `${contents}\n\n${block}`;
  return `${contents.slice(0, lineEnd + 1)}\n${block}\n${contents.slice(lineEnd + 1)}`;
}

async function run({ label, title, entryPoints, entryPointStrategy, files = {}, projectFile, intro }) {
  const app = await Application.bootstrapWithPlugins(
    {
      entryPoints: entryPoints.map(posix),
      entryPointStrategy,
      tsconfig: sitePath('./tsconfig.typedoc.json'),
      out: sitePath(`./src/content/docs/api/${label}`),
      plugin: ['typedoc-plugin-markdown', 'typedoc-plugin-frontmatter'],
      router: 'module',
      entryFileName: 'index',
      readme: 'none',
      hideBreadcrumbs: true,
      // 标题由 Starlight 的 <PageTitle> 渲染，这里再出一个 H1 会变成「标题下面又是标题」
      hidePageTitle: true,
      // 页头是 `**artmatic** • …` 的面包屑，对读者没意义
      hidePageHeader: true,
      // 每个成员下面一行「Defined in: xxx.ts:16」会把页面撑成两倍长，
      // 而页名本身就是文件名，来源是透明的
      disableSources: true,
      includeHierarchySummary: false,
      cleanOutputDir: true,
      /*
       * 入口 program 之外的诊断（`__APP_VERSION__` 与两个第三方 shim）来自
       * ambient .d.ts 没被算进 program，不影响公开签名。真正的类型门禁在根目录的
       * svelte-check，这里不为它挡路。
       */
      skipErrorChecking: true,
    },
    [new TypeDocReader(), new TSConfigReader()],
  );

  app.renderer.on(MarkdownPageEvent.BEGIN, (page) => {
    page.frontmatter = {
      ...(page.frontmatter ?? {}),
      title: page.model.isProject() ? title : page.model.name,
    };
  });

  app.renderer.on(MarkdownPageEvent.END, (page) => {
    const isProject = page.model.isProject();
    if (!isProject && page.model.kind !== ReflectionKind.Module) return;

    // 项目首页没有对应文件，摘要只能由调用方给（core/ 没有桶文件）
    const doc = isProject ? (projectFile ? leadingDoc(projectFile) : intro) : leadingDoc(files[page.model.name]);
    if (doc) page.contents = insertAfterFrontmatter(page.contents, doc);
  });

  const project = await app.convert();
  if (!project) throw new Error(`TypeDoc 转换失败：${label}`);
  await app.generateOutputs(project);
  console.log(`api/${label}  ${project.children?.length ?? 0} 个导出`);
}

const coreDir = sitePath('../src/core');
const coreFiles = Object.fromEntries(
  readdirSync(coreDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f.replace(/\.ts$/, ''), `${coreDir}/${f}`]),
);

await run({
  label: 'core',
  title: 'core',
  entryPoints: [coreDir],
  entryPointStrategy: 'expand',
  files: coreFiles,
  intro:
    '纯 TS 内核：数据模型、曲线求值、命令栈、片段几何、容量预算、位掩码、颜色。\n' +
    '不碰 DOM / WebGL，可以单独跑测试 —— 这一层定死之前，不要写时间轴 UI。',
});

/*
 * agent 分两次单入口跑，而不是一次双入口：
 * 双入口时 `agent/index.ts` 的模块名会取成 `index`，与项目首页的 `index.md`
 * 撞名，插件只好写出 `index-1.md`。单入口时模块被内联进项目，一页一个文件，
 * 标题由 `title` 定。
 */
await run({
  label: 'agent',
  title: '控制面',
  entryPoints: [sitePath('../src/agent/index.ts')],
  entryPointStrategy: 'resolve',
  projectFile: sitePath('../src/agent/index.ts'),
});

await run({
  label: 'agent/llm',
  title: 'LLM 运行时',
  entryPoints: [sitePath('../src/agent/llm/index.ts')],
  entryPointStrategy: 'resolve',
  projectFile: sitePath('../src/agent/llm/index.ts'),
});
