/**
 * gl-transitions.d.ts — 手写模块声明。
 *
 * 上游 `gl-transitions@1.71.0` 是 **CJS 包**（`index.js` 就是一行
 * `module.exports = [ {...}, … ]`，125 条内联 GLSL 字符串），且**不带 @types**。
 *
 * 之所以不装第三方类型包：那些包按「.glsl 文件 + 运行时编译」的形态描述，
 * 与这里的 JSON-ish 内联字符串形状不符，用它反而要把每条都断言一遍。
 *
 * ⚠️ 这个包的 import 边界只有一处（`effects/transitions/catalog.ts` 的
 * `normalizeCatalog`）。dev（dep optimizer）与 build（rollup commonjs 插件）的
 * interop 形态若有出入，只改那一处。
 */

declare module 'gl-transitions' {
  /** 上游一条转场的原始形状，字段名逐字照抄 `gl-transitions` 的 README。 */
  export interface GLTransition {
    name: string;
    author: string;
    license: string;
    /** 只实现 `vec4 transition(vec2 uv)` 的那一段，**不含** head / main。 */
    glsl: string;
    /** 参数默认值。向量是 number[]，bool 是 boolean，其余是 number。 */
    defaultParams: Record<string, number | boolean | number[]>;
    /** 参数类型：float | int | bool | vec2 | ivec2 | vec3 | vec4。 */
    paramsTypes: Record<string, string>;
    createdAt: string;
    updatedAt: string;
  }

  const catalog: GLTransition[];
  export default catalog;
}
