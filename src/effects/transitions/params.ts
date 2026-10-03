/**
 * transitions/params.ts — 参数派生（gl-transitions 的 paramsTypes → 扁平化 ParamDef）
 * 与参数写回（扁平化 values → `gl.uniform*`）。
 *
 * ## 范围是启发式，这不是缺陷是取舍
 *
 * 上游只给「类型 + 默认值」，**不给 min/max**（规范里参数就只有一个默认值）。
 * 手写 125 条 × 平均 3 个参数的滑杆范围既不可持续、又会随上游更新腐化，
 * 所以范围从**作者自己的默认值**推：`d === 0 → [0,1]`，否则
 * `min = min(0, 4d)`、`max = max(1, 4|d|)` —— 给 4 倍余量。
 *
 * 抽查（都是实践里常见的量级，结果可用）：
 *   `pixelSize = 50`  → 0..200      `blocksize = 0.02` → 0..1
 *   `zoom_quickness = 0.8` → 0..3.2 `amplitude = 2` → 0..8
 *
 * 数字框仍然可以**键入**范围内的精确值；范围不合适的条目应当是「上游的作者
 * 默认值本身就怪」，而不是我们推歪了。
 *
 * `int` / `ivec2` 走整数范围（floor/ceil + step 1）—— 否则滑杆会给出
 * `3.84` 个格子这种没有意义的取值。
 */

import type { TransitionParamDef, TransitionUniform } from './types';

/** gl-transitions 的 paramsTypes → 展开出的标量个数。 */
const VECTOR_SIZE: Record<string, number> = {
  float: 1,
  int: 1,
  bool: 1,
  vec2: 2,
  ivec2: 2,
  vec3: 3,
  vec4: 4,
};

export interface DerivedParams {
  params: TransitionParamDef[];
  uniforms: TransitionUniform[];
  /** 认不出的类型：丢弃该 uniform 并记下来（测试断言这里必须是空的）。 */
  unsupported: { name: string; type: string }[];
}

/** 由默认值推一个标量范围。见文件头的取舍说明。 */
export function scalarRange(
  glslType: string,
  d: number,
): { min: number; max: number; step: number } {
  const integer = glslType === 'int' || glslType === 'ivec2';
  let lo: number;
  let hi: number;
  if (!Number.isFinite(d) || d === 0) {
    lo = 0;
    hi = 1;
  } else {
    lo = Math.min(0, d * 4);
    hi = Math.max(1, Math.abs(d) * 4);
  }
  if (integer) {
    const ilo = Math.floor(lo);
    const ihi = Math.ceil(hi);
    return { min: ilo, max: Math.max(ihi, ilo + 1), step: 1 };
  }
  return { min: lo, max: hi, step: (hi - lo) / 200 };
}

function componentOf(raw: unknown, index: number): number {
  if (Array.isArray(raw)) {
    const v = raw[index];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** 从上游的 `paramsTypes` / `defaultParams` 派生可编辑参数。 */
export function deriveTransitionParams(
  paramsTypes: Record<string, string>,
  defaultParams: Record<string, unknown>,
): DerivedParams {
  const params: TransitionParamDef[] = [];
  const uniforms: TransitionUniform[] = [];
  const unsupported: { name: string; type: string }[] = [];

  for (const [name, glslType] of Object.entries(paramsTypes)) {
    const size = VECTOR_SIZE[glslType];
    if (!size) {
      unsupported.push({ name, type: glslType });
      continue;
    }
    uniforms.push({ name, glslType, size });

    const raw = defaultParams[name];
    if (glslType === 'bool') {
      params.push({
        key: name,
        label: name,
        group: name,
        index: 0,
        type: 'checkbox',
        defaultValue: componentOf(raw, 0) ? 1 : 0,
      });
      continue;
    }
    for (let i = 0; i < size; i += 1) {
      const d = componentOf(raw, i);
      const { min, max, step } = scalarRange(glslType, d);
      const single = size === 1;
      params.push({
        key: single ? name : `${name}#${i}`,
        // 向量的分量名用机械写法（`size[0]`）—— 不假装 `.x/.y` 的语义，
        // 因为 ivec2 的 `[0]/[1]` 是「列/行」还是「高/宽」由上游决定。
        label: single ? name : `${name}[${i}]`,
        group: name,
        index: i,
        type: 'range',
        min,
        max,
        step,
        defaultValue: d,
      });
    }
  }
  return { params, uniforms, unsupported };
}

/** 参数默认值表（新建转场时的初值）。 */
export function defaultTransitionValues(params: TransitionParamDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) out[p.key] = p.defaultValue;
  return out;
}

/**
 * 把工程里存的 values 补齐成一份完整的参数表。
 *
 * 必须有这一步：工程可能是在某个转场**加参数之前**存下的，缺键时直接当 0 用
 * 会让画面对不上作者的默认值（而且 0 往往是退化取值，比如 `pixelSize = 0`
 * 会把整个画面糊成一格）。缺键一律回退到 `defaultValue`。
 */
export function fillTransitionValues(
  params: TransitionParamDef[],
  stored: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    const v = stored[p.key];
    out[p.key] = typeof v === 'number' && Number.isFinite(v) ? v : p.defaultValue;
  }
  return out;
}

/**
 * 把扁平化的 values 写成 GLSL uniform。
 *
 * 未激活的 uniform（被编译器优化掉的）拿到的 location 是 null，静默跳过 ——
 * 这不是错误，是正常的死参数。
 */
export function writeTransitionUniforms(
  gl: WebGL2RenderingContext,
  locations: Record<string, WebGLUniformLocation | null>,
  uniforms: TransitionUniform[],
  values: Record<string, number>,
): void {
  for (const u of uniforms) {
    const loc = locations[u.name];
    if (!loc) continue;
    const c = (i: number): number =>
      (u.size === 1 ? values[u.name] : values[`${u.name}#${i}`]) ?? 0;
    switch (u.glslType) {
      case 'float':
        gl.uniform1f(loc, c(0));
        break;
      case 'int':
        gl.uniform1i(loc, Math.round(c(0)));
        break;
      case 'bool':
        gl.uniform1i(loc, c(0) ? 1 : 0);
        break;
      case 'vec2':
        gl.uniform2f(loc, c(0), c(1));
        break;
      case 'ivec2':
        gl.uniform2i(loc, Math.round(c(0)), Math.round(c(1)));
        break;
      case 'vec3':
        gl.uniform3f(loc, c(0), c(1), c(2));
        break;
      case 'vec4':
        gl.uniform4f(loc, c(0), c(1), c(2), c(3));
        break;
      default:
        break;
    }
  }
}
