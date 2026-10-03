/**
 * transitions/types.ts — 转场目录的类型。
 *
 * ## 为什么不在 `effects/types.ts` 的 `ParamDef` 上扩展
 *
 * `ParamDef.labelKey` 是 `MessageKey`（zh-CN 文案表的**字面量键联合**），
 * 而转场的参数名逐字来自 gl-transitions 的第三方作者（`pixelSize` /
 * `blocksize` / `shadow_colour`…），运行时才知道，永远不可能是那个联合的一员。
 * 强行放宽成 `MessageKey | string` 会把特效那一侧的编译期检查一起报废。
 *
 * 所以转场自带一套**平行**的参数类型：结构上够用（range / checkbox），
 * 但不要求 labelKey —— 它的 `label` 是原始字符串，**刻意不翻译**：
 * 界面上显示 `pixelSize` 才能对着上游文档查这条转场在干什么。
 *
 * ## 向量为什么被「扁平化」
 *
 * GLSL 的 `vec4 bgcolor` 在工程里存成 4 个标量（键 `bgcolor#0`…`bgcolor#3`）。
 * 这样 `TransitionRef.values` 能保持 `Record<string, number>`，与
 * `EffectInstance.values` 的标量约定一致 —— 于是检查器可以直接复用现成的
 * Slider / NumberInput / Checkbox，不需要新控件，也不需要动 schema 的值类型。
 * 重组回 `gl.uniform4f` 的动作在 `params.ts::writeTransitionUniforms`。
 */

/** 一个 GLSL uniform：扁平化参数的**组**。 */
export interface TransitionUniform {
  /** GLSL 里的名字（`pixelSize` / `size` / `bgcolor`…）。 */
  name: string;
  /** GLSL 类型，决定写 uniform 时用哪个 `uniformNf` / `uniformNi`。 */
  glslType: string;
  /** 展开出的标量个数：float/int/bool = 1，vec2/ivec2 = 2，vec3 = 3，vec4 = 4。 */
  size: number;
}

/**
 * 一个可编辑的参数（可能只是某个向量的一维）。
 *
 * `label` 是**面向用户**的显示名，但它来自第三方 GLSL 的作者命名，
 * 不是我们的文案 —— 所以不进语言文件、不翻译（见文件头）。
 */
export interface TransitionParamDef {
  /** `values` 里的键：标量是 uniform 名本身，向量分量是 `name#index`。 */
  key: string;
  /** 显示名。标量 = uniform 名；向量分量 = `name[0]`。 */
  label: string;
  /** 所属 uniform（写回 uniform 时分组用）。 */
  group: string;
  /** 在该 uniform 里的分量下标；标量为 0。 */
  index: number;
  type: 'range' | 'checkbox';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
}

/** 目录里的一条转场（已经过许可过滤与规范化）。 */
export interface TransitionEntry {
  /** gl-transitions 的 `name`，也是工程里 `TransitionRef.defId` 的值。 */
  id: string;
  /** 上游作者。显示在选择器的提示里 —— 既是可追溯性，也是 MIT/BSD 的署名要求。 */
  author: string;
  /** 上游声明的许可证（'MIT' / 'BSD 2 Clause' / 'BSD 3 Clause'）。 */
  license: string;
  params: TransitionParamDef[];
  uniforms: TransitionUniform[];
  /** 可直接交给 `kit.quad()` 的完整 fragment（head + body + main）。 */
  fragment: string;
}
