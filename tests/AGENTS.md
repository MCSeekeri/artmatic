# tests/ —— 测试约定（单测 / 守卫 / 变异测试）

vitest **只测纯函数**；Playwright 管 E2E（渲染类那三条硬规矩在 `tests/e2e/AGENTS.md`）。
**守卫必须被验证过才算守卫** —— 纯函数层用 `bun run test:mutate` 自动验。

**何时读我**：加一个测试或守卫；改断言口径；**跑回归之前**（分层表在本文件里）。

相关：`tests/e2e/AGENTS.md`、根 `AGENTS.md` 的命令块与「协作约定」。

---

- **单测只测纯函数**：曲线求值、时间换算、命令栈、schema 迁移、颜色 / 合成数学、
  片段几何。不测 DOM、不测 WebGL。
- **文案改动只需跑 `vitest run tests/unit/i18n.test.ts`**。**改一句中文绝不应该需要改组件代码。**
- **E2E 走 Playwright + 系统 Chrome**（`channel: 'chrome'`），不需要 `playwright install`。
  E2E 服务器要正确返回 `.mjs` 的 `text/javascript` MIME，否则 ESM import 会被拦掉。
- **加了一个新参数类型 / 新守卫之后要在这里补一条**：
  - `tests/unit/algo-params.test.ts` —— 遍历**所有**注册生成器与特效的参数表：
    类型在已知集合内、文案键能解析、`select.defaultValue` 在选项里、`bitmask` 位数自洽、
    `visibleWhen` 引用的键存在。**「加了参数忘了接 UI / 忘了加文案」在这里变成失败。**
  - `tests/unit/algo-tint-uniforms.test.ts` —— **`sim` 的自定义着色**（`def.tintFragment`）
    的接线自检。`tests/unit/algo-uniforms.test.ts` 的 `probeGenerator` 遇到 `kind !== 'realtime'`
    直接返回 null，所以**它对 sim 的 tint 一无所知**；而 tint 走的是同一套手工派发，
    同一类静默失效（声明了没写 / 对 vec3 调 uniform1f / 名字拼错）原样存在。
    它有一条**刻意会红**的非空断言：没有任何 sim 用自定义着色时，
    上面几条 `test.each` 全是空转 —— 空转的守卫比没有守卫更坏。
  - `tests/unit/pattern-codec.test.ts` / `tests/unit/bitmask.test.ts` / `tests/unit/pattern-paint.test.ts` ——
    纯函数（编解码往返、非法输入降级、位序、Bresenham 补线、居中裁剪）。
  - `tests/unit/cellular-automata.test.ts` / `tests/unit/lenia-wireworld.test.ts` /
    `tests/unit/reaction-diffusion.test.ts` —— Wave 2 那 7 个 sim。里面有几条**解析不变量**
    才算真守卫：反应扩散 `F=k=0` 时 `Σ(u+v)` 守恒、沙堆的**阿贝尔性**（fifo 与 lifo
    两种崩塌顺序的终止态逐格相同）、雪花「冰只增不减」、循环 CA「默认参数下相邻两步
    必须有格子在变」（这条直接抓「冻死」）。
  - `tests/e2e/algo-sim.spec.ts` —— sim 的渲染断言。**sim 一律用 `settle`，
    不要用 `waitForSourceReady`**（后者的 minMean 判据是给整幅非黑准备的）。
  - `tests/unit/curve-meta.test.ts` —— 曲线编辑器的参数量纲与「能不能打关键帧」
    判据（realtime 全部 range / bake 只有 speed / sim 全不可 / 特效按 instanceId
    展开 / 音频只有 gain / 已失效曲线仍要列出来）。它与 `Inspector.svelte::keyframable`
    是同一条判据的两处落点，改一处必须同时改另一处。
  - `tests/unit/curve-geometry.test.ts` —— 曲线的屏幕映射、step 直角折线、片段迷你
    曲线（纯函数；别在 E2E 里读 SVG 路径来替代它）。
  - `tests/unit/popover.test.ts` 的 `computePreviewPosition` —— 菜单预览浮层在任何
    翻边情况下都不能与菜单面板相交。`tests/e2e/insert-menu.spec.ts` 有一条真界面
    回归（靠右右键 → 二级左翻 → 悬停预览）。
  - `tests/unit/color.test.ts` —— `hexToRgb` / `rgbToHex` 的坏值回落（NaN 不能写进
    hex）。`tests/e2e/runtime-errors.spec.ts` —— 未捕获错误 / rejection 必须能落到底栏，
    详情 Modal 可清空。
  - `scripts/check-bundle.mjs` —— 构建产物守卫（首屏 preload / lucide 分片 /
    `dist/assets` 总数）。`bun run build` 与 `scripts/e2e.mjs` 都会跑；改构建配置后
    先看它的输出。
    ⚠️ **空转探针红旗**：任何「两个配置 hash 不同」的断言，前面必须先有一条
    `meanAt > 阈值` —— 否则两张黑图不同也会「通过」。

- **新守卫必须被验证过才算守卫**。**纯函数层用 `bun run test:mutate` 自动验（见本文件）；
  手工 A/B 只留给你够不到的那一层 —— E2E 的 GPU 读回标量。** 下面这些是手工跑过的样本：
  - 位表行序守卫：把 `bitRows` 的 `'eca'` 改成低位在前 → `tests/unit/bitmask.test.ts` 变红。
  - codec 越界守卫：拿掉尺寸上限那一行 → 「坏头部 → null」变红。
  - `visibleWhen` 引用守卫：把 `v.seedMode` 改成 `v.seedModeX` → `tests/unit/algo-params.test.ts` 变红
    （**类型系统拦不住**：`v` 是 `Record<string, number|string>`）。
  - 边界参数守卫：让 `lifeStepRule` 忽略 `wrap` 恒走环面 → 「固定边界改变下一代」变红。
  - `volatile` 守卫：把 `cacheHash` 改回 `JSON.stringify(params)` → 「改配色不换哈希」变红。
  - **sim tint 守卫**（两条都实际跑过）：删掉 `setTintUniforms` 里的一行
    → 「声明了却没写」变红；把 `set1f('u_contrast', …)` 换成 `set1i`
    → 「写入类型与声明不匹配」变红。
  - **步进预算**（`tests/unit/sim-scrub.test.ts`）：让 `planSimStep` 直接返回
    `target`（等于没压预算）→ 3 条变红；让 `afford` 恒为 0（计划不前进）
    → 「每帧都前进 / 一定能收敛」变红。
  - **沙堆出厂默认**：把 `size`/`batch` 改回 256/200 → 「跑满时间轴不许有
    `v > 166` 的格子」变红（实测 185 个）。
  - **沙堆崩塌后重入队**：删掉那一行 → 「预先堆高的格子会一路塌到稳定」变红
    （`done` 从 1 起、`maxH` 停在 170）。
  - **`TorusField` 的 halo**：把上下两条 halo 改成只复制中段（不连左右一起）
    → 与朴素回绕逐位对拍的用例变红（四个角错了）。
  - **「声明了但没被读过」**（`lab.spec`，唯一能抓「参数拨了没反应」的地方）：
    把 `menger` 里 `p = twistY(p, u_twist);` 删掉 → 红（`menger: u_twist`）。
    这条的**允许清单从源码推**（`ALGO_HEAD` 的键任意丢弃；`SCENE_GLSL` 那批
    音频/编排 uniform 只对 `scene-*` 放行），不留硬编码列表。
  - **3D 家族契约**（`tests/unit/fractals3d.test.ts`，14 条）：覆盖面自检
    （正好是 apollonian/mandelbulb/menger）、前向声明存在、共用参数不缺不重、
    文案键同源、palette 选项都在映射表里、内核里不出现任何具体生成器的参数名。
  - **3D 的「换了画面」判据**：`algos3d.spec` 用**分块均值的 L1**。判据选错的
    代价实测过 —— 拿「覆盖像素数之差」当形状代理，幂次 3 与 8 的**面积接近而
    形态完全不同**，那条断言直接把正确的实现判死。噪声底实测 **0.000**
    （同配置两次独立加载逐块一致），而换幂次是 80.8、换迭代是 14.2。
  - **预览浮层的覆盖**（`tests/e2e/algo-preview.spec.ts`）：把浮层的定位锚点从「行的右边」
    改成「行的左边」→ 「浮层不盖住当前高亮的那一项」变红（`elementFromPoint`
    命中浮层而不是菜单项）。这条**不能只断浮层存在** —— 压在菜单上的浮层
    在 DOM 断言与可见性断言下全都正常，只是那一项点不到。
  - **缩略图资源对齐**：把一个 `.webp` 改名 → `tests/unit/algo-thumb-assets.test.ts` 同时
    报「缺缩略图」与「孤儿资源」；把某个 sim 的 `previewT` 改成 0 →
    「sim·bake 必须显式给 previewT 且 > 0」变红。**把 `thumb` 从菜单项上去掉**
    → `tests/e2e/algo-preview.spec.ts` 四条全红。
  - **影响深度**（`tests/e2e/effect-scope.spec.ts`）：两条**互相独立**的判据 —— 作用域外的轨道与
    「关掉特效轨」时的基线**逐像素相同**（≤2 的量化余量），作用域内确实被改了。只断
    「画面变了」的话，一个把整幅都去色的错误实现照样过。底图用高饱和纯色：去色后三通道
    贴到一起，与「没被碰过」的纯色一眼可分。
  - **modal 的层叠**（`tests/e2e/modal-layering.spec.ts`）：判据**不是比 z-index**（那不看
    层叠上下文），而是算**有效层级** —— 自己那层与沿途每个上下文的 z 取最小，
    然后把「与 modal 面板相交、又不在 modal 子树里」的元素全算一遍，断言没有
    一个更高。后面那条用例**内建了反向验证**：把抽屉压回出事的 `z-index: 1`，
    断言 `ruler` 确实会盖上来。
  - 以上都是**改回去 → 看红 → 恢复 → 看绿**跑过一遍的。

- **分层回归**（不要盲目全量）：

  | 级别 | 改动 | 跑什么 |
  |---|---|---|
  | A | core / engine / 共享类型 | 全量 E2E |
  | B | 单个模块 / 单个特效 | 该模块 E2E + 单测 |
  | C | 数据 / 文档 / 常量 | engine 单测 + JSON 校验 |
  | D | 只改语言文件 | `vitest run tests/unit/i18n.test.ts` |

  D 级是刻意留的：如果改文案还要跑 E2E，说明有断言绑在了渲染后的字符串上
  （如 `toContainText('已保存')`）。那种断言只有**跨语言**才会失效，允许存在，
  但要意识到它把文案变成了契约。

---

## 变异测试（测试的测试）

`bun run test:mutate` 走 **Stryker**：把源码逐处改错（一个 mutant = 一处改动）再跑测试。
测试挂了 = **killed**（守卫有效）；测试照样绿 = **survivor**（守卫其实没挡住）。
这就是「把 bug 改回去、看它红不红」那件事的自动化版本，也是 本文件那条纪律的执行者。

```bash
bun run test:mutate -- --mutate src/core/bitmask.ts    # 单文件（秒级）
STRYKER_MUTATE=src/core/curve.ts bun run test:mutate   # 或走环境变量
bun scripts/mutate-triage.mjs --diff HEAD              # 只看本次改动命中的行
```

- 配置在 `stryker.config.mjs`：`testRunner: 'vitest'` + `vitest.configFile: 'vite.config.ts'` +
  **`coverageAnalysis: 'perTest'`**（每个 mutant 只跑覆盖到它的那几条测试，5–10× 提速）。
  `mutate` 默认 `src/core/**/*.ts`。
- **范围要收窄到本次改动** —— 全量 `src/core/**` 会明显更慢。这正是上游实践的粒度：
  Google 是**只变异本次 changelist 涉及的行**、并在代码评审时增量跑。
- `.stryker-report.json` 是 200KB 级，**别直接读**。`scripts/mutate-triage.mjs` 压成
  「一行一条」，`--diff <ref>` 只留改动命中的行，`--limit N` 截断，`--json` 给上层脚本。
  用 `bun` 跑它（个别沙箱里 node 起不了 git，脚本会降级成不过滤并提示）。
- ⚠️ **survivor 只有三种成因，必须靠「补一条候选测试再重跑」来判，不能眼看行号推断**：

  | 成因 | 判据 | 处置 |
  |---|---|---|
  | 真缺口 | 补一条能区分的输入 → 变 Killed | 测试留下 |
  | 等价 mutant | 任何输入都不可区分（末尾有 `clampMask` 兜底、`undefined` 为 falsy 之类） | 忽略，用源码内 `Stryker disable` 注释钉掉 |
  | 不可达 | 分支被调用方契约钳死 | 同上 |

- ⚠️ **同一个 `replacement` 会在同一行出现多次，只有 start/end 列不同** ——
  `ConditionalExpression` 对 `a || b` 的**每个操作数**都生成 mutant。按行号去重或推断必错。
- ⚠️ **survivor 是 backlog，不是 gate。** 看前 3-5 条就停，别追 100% 分数 ——
  等价 mutant 是天花板的一部分。
- ⚠️ `UpdateOperator` 的 `i-- → i++` 会 **Timeout**（死循环）。那是**真信号**，别当噪声丢掉。
- **边界**：Stryker 只覆盖 vitest 那一层（纯函数，`test.include` 限死 `tests/unit`）。
  E2E 的 GPU 读回标量它够不到 —— 那层要么继续手工 A/B，要么把已知 buggy 的输出录成
  **负样本 fixture**，让守卫在 CI 里自证。
- 环境：`node_modules/.bin` 里只有 `stryker.bunx` / `stryker.exe`（**没有裸 `stryker`**），
  `bunx` 也不在 PATH —— 一律走 `bun run test:mutate` 或 `bun x`。
  `.stryker-tmp/` 与报告产物已 gitignore。
