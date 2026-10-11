/**
 * loader.ts — 把一个插件文件的**字节**变成一个 ES 模块。
 *
 * 做法是唯一可行的那条：`Blob` → `URL.createObjectURL` → 原生 `import()`。
 * （`data:` URL 也能 import，但它对长源码会把整段代码塞进 URL，且各浏览器
 * 对 `data:text/javascript` 的 MIME 处理不完全一致；blob 更干净。）
 *
 * ## 三条必须知道的限制
 *
 * 1. **插件必须是单文件，不能有相对导入。** blob URL 没有有意义的 base，
 *    `import './helper.js'` 无从解析。这是特性不是缺陷 —— 工程目录因此始终
 *    是可移植的（一个插件 = 一个文件 = 一个 id）。真需要多文件的插件，
 *    作者自己打包成一个文件即可。
 *
 * 2. **超时只是「不再等」，不是「取消」。** 动态 import 没有取消机制：
 *    一个卡在顶层 `await` 的模块，超时之后仍可能自己完成并执行副作用。
 *    这是「插件就是任意代码」这一安全模型的必然结果，不是这里能修的。
 *    所以超时值只用来保证**打开工程不被无限期卡住**，不当作隔离手段。
 *
 * 3. **顶层死循环会让整个页面卡死。** 同 2，无法在页面内防御。
 *    真到那一步用户只能关标签页；插件源码的事前审查（导入确认框里明说的那条）
 *    才是唯一的防线。
 *
 * 用完立刻 `revokeObjectURL`：不撤销的话，每导入一次插件都会把整份源码
 * 常驻在内存里（blob 的引用计数由浏览器管，我们只能保证自己不再持有）。
 */

/** 默认超时。够慢机器上解析一个几百 KB 的模块，又不会让人以为界面死了。 */
export const PLUGIN_IMPORT_TIMEOUT_MS = 8000;

export type PluginModuleResult =
  | { ok: true; mod: unknown }
  | { ok: false; code: 'import-failed' | 'timeout'; detail: string };

/**
 * 导入一个插件模块。
 *
 * **不抛**：失败是预期内的结果（语法错误、顶层抛异常、超时），由调用方
 * 翻译成一条可展示的失败原因。抛出去的话调用点得写 try/catch，
 * 而漏写一处的表现是「打开工程崩在插件上」。
 */
export async function importPluginModule(
  bytes: Uint8Array,
  timeoutMs = PLUGIN_IMPORT_TIMEOUT_MS,
): Promise<PluginModuleResult> {
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, code: 'import-failed', detail: 'empty' };
  }

  const blob = new Blob([bytes as unknown as BlobPart], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<PluginModuleResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, code: 'timeout', detail: String(timeoutMs) });
      }, timeoutMs);
    });
    /*
     * `@vite-ignore` 是必须的：地址是运行期才有的变量，Vite 的静态分析会
     * 尝试把它当成「项目内的模块」去解析并告警。这里要的就是**交给浏览器**。
     */
    const load: Promise<PluginModuleResult> = import(/* @vite-ignore */ url).then(
      (mod) => ({ ok: true, mod }),
      (e) => ({ ok: false, code: 'import-failed', detail: errText(e) }),
    );
    return await Promise.race([load, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
