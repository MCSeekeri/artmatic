/**
 * polyhedron.ts — 正多面体线框（realtime 型）。
 *
 * ## 它不是「投影几个点连起来」那么简单，但也没必要做光线步进
 *
 * 线框的每一根都是**一条线段**，而线段在屏幕上的形状有解析解 —— 所以这里
 * 不需要 SDF、不需要步进：把顶点投到 uv 空间，逐棱算「像素到线段的距离」，
 * 按距离画核心 + 辉光。代价是每像素一圈棱（最多 96 条），换来的是
 * **精确的抗锯齿、精确的深度、任意细的线也不会断**。
 *
 * 走 SDF 反而做不到这些：棱是零厚度集合，距离场在棱外处处是「离得最近的面」
 * 而不是「离得最近的棱」，细线会被步长跨过去 —— 那正是线框最难做对的地方。
 *
 * ## 三维与四维是同一条路径
 *
 * 顶点存成 `vec4`，三维形体的 `w` 恒为 0。于是：
 *
 * - 投影 `p.xyz * wDist / (wDist + p.w)` 对三维是**恒等**；
 * - 旋转 `planeRot` 拿两个基向量，三维的旋转平面永远不含 `w`。
 *
 * 所以「四维」不是第二个生成器，也不是第二个 `if` 分支 —— 是同一个循环里
 * 某个分量恰好为 0。少一条路径就少一处「三维好、四维坏」。
 *
 * ## 时间只读 `u_time`
 *
 * 转角是闭式 `u_time * speed`，不累积相位（硬约束 1.1）。拖时间轴到同一秒
 * 拿到逐像素相同的一帧。
 *
 * 几何数据见 `polyhedra.ts`（顶点一律外接半径 1）。
 */

import { colorVec3 } from '../core/color';
import { bgColorVisible, bgModeParam, intResParam } from './shader-lib';
import {
  MAX_SHAPE_EDGES,
  MAX_SHAPE_VERTS,
  POLY_GLSL,
  SHAPE_RANGE,
  rotPlanes,
  shapeById,
} from './polyhedra';
import type { ParamDef, SelectParam } from '../effects/types';
import type { GeneratorDef } from './types';

/**
 * 形体 id → 缺省值。字符串参数直接进工程 JSON，所以这张表同时也是
 * 「老工程里认不出的 id 会落到哪个形体」的答案（`shapeById` 返回 null 时取第一个）。
 */
const FALLBACK_SOLID = 'icosa';
const FALLBACK_CELL = 'cell8';

const BODY = `
uniform int   u_vBase;    // 形体在顶点表里的起点
uniform int   u_vCount;
uniform int   u_eBase;    // 形体在棱表里的起点
uniform int   u_eCount;
uniform int   u_p1a;      // 主旋转平面（两个坐标轴号）
uniform int   u_p1b;
uniform int   u_p2a;      // 次旋转平面（轴进动）
uniform int   u_p2b;
uniform float u_speed;    // 主旋转角速度（弧度/秒）
uniform float u_precess;  // 次旋转速度 / 主旋转速度
uniform float u_wdist;    // 四维透视：4D→3D 的「眼距」，越大越平
uniform float u_elev;     // 视点仰角（弧度）
uniform float u_scale;    // 画幅占比
uniform float u_weight;   // 线宽（像素）
uniform float u_glow;     // 辉光
uniform float u_dash;     // 虚线（0 = 实线）
uniform float u_dots;     // 顶点圆点
uniform float u_fade;     // 纵深衰减
uniform int   u_dual;     // 1 = 按纵深双色
uniform vec3  u_color;
uniform vec3  u_colorB;
uniform vec3  u_bg;
uniform int   u_bgMode;

/* 相机：固定 3 个单位的眼距。单位球在 1.35 的增益下占约六成画高。 */
const float CAM_DIST = 3.0;
const float CAM_GAIN = 1.35;

/**
 * 在 A、B 张成的平面里旋转。
 *
 * 不用「对 vec4 做动态下标再交换分量」：动态下标在部分驱动上会展开成一串
 * 分支，而这里每个顶点要转两次。两个基向量都是单位且正交，展开成
 * 「沿 A、B 的两个分量重算」既没有分支也没有精度问题。
 */
vec4 planeRot(vec4 v, vec4 A, vec4 B, float c, float s) {
  float da = dot(v, A);
  float db = dot(v, B);
  return v + A * (da * (c - 1.0) - db * s) + B * (da * s + db * (c - 1.0));
}

/**
 * 4D → 3D。w 恒为 0 时是恒等，所以三维形体走的是同一条式子。
 *
 * 除以 (wDist + w) 而不是 (wDist − w)：顶点 w 最大到 1（外接半径 1），保证分母
 * 恒正、不会在某个角度上出现「顶点飞到无穷远」的爆点。
 */
vec3 project4(vec4 p) {
  return p.xyz * (u_wdist / (u_wdist + p.w));
}

/**
 * 世界点 → uv 空间（纵向跨 1.0），同时回传相机空间的 z 做纵深衰减。
 *
 * 仰角是绕 x 轴的一次固定旋转：正对着一根坐标轴看的时候，立方体会退化成一个
 * 正方形 —— 那不是「自旋」，是「没动」。抬 18° 之后每根棱都有长度。
 */
vec2 screenOf(vec3 p, out float depth) {
  float ce = cos(u_elev);
  float se = sin(u_elev);
  vec3 q = vec3(p.x, p.y * ce + p.z * se, -p.y * se + p.z * ce);
  depth = q.z;
  return q.xy * (CAM_GAIN / max(CAM_DIST - q.z, 0.35)) * u_scale;
}

/** 点到线段距离。h 是最近点在线段上的参数（0..1），虚线按它切。 */
float segDist(vec2 p, vec2 a, vec2 b, out float h) {
  vec2 ab = b - a;
  float l2 = max(dot(ab, ab), 1e-12);
  h = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
  return length(p - a - ab * h);
}

/** 纵深 → 亮度系数。near 归一到 -1..1（正 = 离镜头近）。 */
float depthAtt(float z, float fade) {
  float near = clamp(z * 0.6, -1.0, 1.0);
  return mix(1.0, 0.18, fade * (0.5 - 0.5 * near));
}

void main() {
  vec2 uv = (vUv - 0.5) * vec2(u_aspect, 1.0);
  /*
   * 线宽按**内部渲染**的像素给：uv 的纵向跨度是 1.0，所以一像素 = 1 / 高度。
   *
   * 于是改 intRes 会让线在屏幕上跟着变粗变细（内部 240p 放大到 1080p 就是
   * 4.5 倍）。这是有意的：按屏幕像素给的话，240p 下的细线会碎成点。
   */
  float px = 1.0 / max(u_resolution.y, 1.0);
  float w = max(u_weight, 0.4) * px;

  float a1 = u_time * u_speed;
  float a2 = a1 * u_precess;
  float c1 = cos(a1);
  float s1 = sin(a1);
  float c2 = cos(a2);
  float s2 = sin(a2);
  vec4 A1 = AX[u_p1a];
  vec4 B1 = AX[u_p1b];
  vec4 A2 = AX[u_p2a];
  vec4 B2 = AX[u_p2b];

  vec3 col = vec3(0.0);
  float cover = 0.0;

  /*
   * 棱。循环上界是**最大形体的棱数**（编译期常量），实际条数由 u_eCount 截断 ——
   * GLSL ES 的循环界要么是常量、要么驱动得支持得很好，而这里是每像素的
   * 主循环，不值得赌。
   *
   * 加色叠加而不是取最大值：线框的价值全在「交叠处更亮」—— 那是玻璃管、
   * 霓虹管的读法。取最大值会让交叉点与单根线一样亮，整幅变成一张平网。
   */
  for (int i = 0; i < ${MAX_SHAPE_EDGES}; i++) {
    if (i >= u_eCount) break;
    ivec2 e = PE[u_eBase + i];
    vec4 va = planeRot(PV[u_vBase + e.x], A1, B1, c1, s1);
    vec4 vb = planeRot(PV[u_vBase + e.y], A1, B1, c1, s1);
    /* precess = 0 时 c2 = 1、s2 = 0，这两行是恒等 —— 不需要额外的 if。 */
    va = planeRot(va, A2, B2, c2, s2);
    vb = planeRot(vb, A2, B2, c2, s2);

    float za;
    float zb;
    vec2 sa = screenOf(project4(va), za);
    vec2 sb = screenOf(project4(vb), zb);

    float h;
    float d = segDist(uv, sa, sb, h);
    float zc = (za + zb) * 0.5;
    float att = depthAtt(zc, u_fade);

    float dash = 1.0;
    if (u_dash > 0.001) {
      /* 段数按**屏幕长度**给，不是按参数 —— 否则长短棱的虚线疏密完全不同。 */
      float rep = max(1.0, length(sb - sa) * 26.0);
      dash = step(fract(h * rep), 1.0 - u_dash * 0.88);
    }

    float core = 1.0 - smoothstep(w * 0.55, w, d);
    float halo = exp(-(d * d) / max(w * w * 16.0, 1e-12));
    float m = dash * att;
    vec3 c = u_dual == 1 ? mix(u_color, u_colorB, 0.5 - 0.5 * clamp(zc * 0.6, -1.0, 1.0)) : u_color;
    col += c * (core + halo * u_glow * 0.5) * m;
    cover += core * m;
  }

  if (u_dots > 0.001) {
    float r = max(u_dots * 0.014, w * 0.9);
    for (int i = 0; i < ${MAX_SHAPE_VERTS}; i++) {
      if (i >= u_vCount) break;
      vec4 v = planeRot(PV[u_vBase + i], A1, B1, c1, s1);
      v = planeRot(v, A2, B2, c2, s2);
      float z;
      vec2 sp = screenOf(project4(v), z);
      float att = depthAtt(z, u_fade);
      float m = (1.0 - smoothstep(r * 0.45, r, length(uv - sp))) * att;
      vec3 c = u_dual == 1 ? mix(u_color, u_colorB, 0.5 - 0.5 * clamp(z * 0.6, -1.0, 1.0)) : u_color;
      col += c * m * 1.2;
      cover += m;
    }
  }

  /*
   * 亮度与色相分开收口。
   *
   * 直接把累加色压一道软肩（1 - exp(-col)）在**只有一根线**时是对的，一多就
   * 烧成白：二十面体的顶点附近有五六根棱交叠，各自的颜色加起来顶到 1，于是
   * 「按纵深双色」在交叠处全变成白。所以先除以覆盖度拿到**平均颜色**，再乘
   * 一个从覆盖度来的亮度 —— 交叠只让它更亮，不改色相。
   */
  vec3 loud = col / max(cover, 1e-4) * (1.0 - exp(-cover * 1.3));
  float a = clamp(cover, 0.0, 1.0);
  /* 透明底吐「墨色 + 覆盖度」（直通 alpha），与 TINT_FRAG 同一约定。 */
  outColor = u_bgMode == 1 ? vec4(loud, a) : vec4(mix(u_bg, loud, a), 1.0);
}`;

/* ------------------------------------------------------------------ 参数 */

function solidSelect(): SelectParam {
  return {
    key: 'solid',
    labelKey: 'algo.polyhedron.solid',
    type: 'select',
    defaultValue: FALLBACK_SOLID,
    visibleWhen: (v) => v.dim !== '4d',
    options: [
      { labelKey: 'algo.polyhedron.solidTetra', value: 'tetra' },
      { labelKey: 'algo.polyhedron.solidCube', value: 'cube' },
      { labelKey: 'algo.polyhedron.solidOcta', value: 'octa' },
      { labelKey: 'algo.polyhedron.solidDodeca', value: 'dodeca' },
      { labelKey: 'algo.polyhedron.solidIcosa', value: 'icosa' },
    ],
  };
}

export const polyhedronDef: GeneratorDef = {
  id: 'polyhedron',
  nameKey: 'algo.polyhedron',
  kind: 'realtime',
  fragment: POLY_GLSL + BODY,
  params: [
    {
      key: 'dim',
      labelKey: 'algo.polyhedron.dim',
      type: 'select',
      defaultValue: '3d',
      options: [
        { labelKey: 'algo.polyhedron.dim3', value: '3d' },
        { labelKey: 'algo.polyhedron.dim4', value: '4d' },
      ],
    },
    solidSelect(),
    {
      key: 'cell',
      labelKey: 'algo.polyhedron.cell',
      type: 'select',
      defaultValue: FALLBACK_CELL,
      visibleWhen: (v) => v.dim === '4d',
      options: [
        { labelKey: 'algo.polyhedron.cell5', value: 'cell5' },
        { labelKey: 'algo.polyhedron.cell8', value: 'cell8' },
        { labelKey: 'algo.polyhedron.cell16', value: 'cell16' },
        { labelKey: 'algo.polyhedron.cell24', value: 'cell24' },
      ],
    },
    /* 两个轴分开给：四维的选项多一个 W，而 select 的选项表是静态的 ——
       把 W 塞进同一个下拉框，三维下选到它就是「选了没反应」。 */
    {
      key: 'axis3',
      labelKey: 'algo.polyhedron.axis3',
      type: 'select',
      defaultValue: 'y',
      visibleWhen: (v) => v.dim !== '4d',
      options: [
        { labelKey: 'algo.polyhedron.axisX', value: 'x' },
        { labelKey: 'algo.polyhedron.axisY', value: 'y' },
        { labelKey: 'algo.polyhedron.axisZ', value: 'z' },
      ],
    },
    {
      key: 'axis4',
      labelKey: 'algo.polyhedron.axis4',
      type: 'select',
      defaultValue: 'y',
      visibleWhen: (v) => v.dim === '4d',
      options: [
        { labelKey: 'algo.polyhedron.axis4X', value: 'x' },
        { labelKey: 'algo.polyhedron.axis4Y', value: 'y' },
        { labelKey: 'algo.polyhedron.axis4Z', value: 'z' },
        { labelKey: 'algo.polyhedron.axis4W', value: 'w' },
      ],
    },
    { key: 'speed', labelKey: 'algo.polyhedron.speed', type: 'range', min: 0, max: 4, step: 0.01, defaultValue: 0.6 },
    {
      key: 'precess',
      labelKey: 'algo.polyhedron.precess',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.25,
    },
    {
      key: 'wdist',
      labelKey: 'algo.polyhedron.wdist',
      type: 'range',
      min: 2,
      max: 6,
      step: 0.05,
      defaultValue: 2.4,
      visibleWhen: (v) => v.dim === '4d',
    },
    { key: 'elev', labelKey: 'algo.polyhedron.elev', type: 'range', min: -60, max: 60, step: 1, defaultValue: 18 },
    { key: 'scale', labelKey: 'algo.polyhedron.scale', type: 'range', min: 0.3, max: 1.8, step: 0.01, defaultValue: 1 },
    { key: 'weight', labelKey: 'algo.polyhedron.weight', type: 'range', min: 0.5, max: 6, step: 0.1, defaultValue: 1.8 },
    { key: 'glow', labelKey: 'algo.polyhedron.glow', type: 'range', min: 0, max: 2, step: 0.01, defaultValue: 0.8 },
    { key: 'dash', labelKey: 'algo.polyhedron.dash', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'dots', labelKey: 'algo.polyhedron.dots', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'fade', labelKey: 'algo.polyhedron.fade', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    {
      key: 'coloring',
      labelKey: 'algo.polyhedron.coloring',
      type: 'select',
      defaultValue: 'single',
      options: [
        { labelKey: 'algo.polyhedron.coloringSingle', value: 'single' },
        { labelKey: 'algo.polyhedron.coloringDepth', value: 'depth' },
      ],
    },
    { key: 'color', labelKey: 'algo.polyhedron.color', type: 'color', defaultValue: '#7fe9ff' },
    {
      key: 'colorB',
      labelKey: 'algo.polyhedron.colorB',
      type: 'color',
      defaultValue: '#ff5ad0',
      visibleWhen: (v) => v.coloring === 'depth',
    },
    { key: 'bg', labelKey: 'algo.polyhedron.bg', type: 'color', defaultValue: '#05070d', visibleWhen: bgColorVisible },
    bgModeParam(),
    intResParam(),
  ],
  setUniforms: (gl, l, v, ctx) => {
    const set1f = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    const set1i = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1i(loc, Math.round(value));
    };
    const set3 = (name: string, hex: string): void => {
      const loc = l[name];
      if (!loc) return;
      const [r, g, b] = colorVec3(hex);
      gl.uniform3f(loc, r, g, b);
    };

    const dim4 = v.dim === '4d';
    const wanted = String(dim4 ? (v.cell ?? FALLBACK_CELL) : (v.solid ?? FALLBACK_SOLID));
    /* 认不出的 id（老工程 / 手改过的 JSON）落到第一个形体，而不是渲一片空白。 */
    const shape = shapeById(wanted) ?? (dim4 ? shapeById(FALLBACK_CELL) : shapeById(FALLBACK_SOLID))!;
    const range = SHAPE_RANGE[shape.id]!;
    set1i('u_vBase', range.vBase);
    set1i('u_vCount', range.vCount);
    set1i('u_eBase', range.eBase);
    set1i('u_eCount', range.eCount);

    const [p1a, p1b, p2a, p2b] = rotPlanes(dim4 ? 4 : 3, String(dim4 ? (v.axis4 ?? 'y') : (v.axis3 ?? 'y')));
    set1i('u_p1a', p1a);
    set1i('u_p1b', p1b);
    set1i('u_p2a', p2a);
    set1i('u_p2b', p2b);

    set1f('u_speed', Number(v.speed ?? 0.6));
    set1f('u_precess', Number(v.precess ?? 0.25));
    set1f('u_wdist', Number(v.wdist ?? 2.4));
    set1f('u_elev', (Number(v.elev ?? 18) * Math.PI) / 180);
    set1f('u_scale', Number(v.scale ?? 1));
    set1f('u_weight', Number(v.weight ?? 1.8));
    set1f('u_glow', Number(v.glow ?? 0.8));
    set1f('u_dash', Number(v.dash ?? 0));
    set1f('u_dots', Number(v.dots ?? 0));
    set1f('u_fade', Number(v.fade ?? 0.5));
    set1i('u_dual', v.coloring === 'depth' ? 1 : 0);
    set3('u_color', String(v.color ?? '#7fe9ff'));
    set3('u_colorB', String(v.colorB ?? '#ff5ad0'));
    set3('u_bg', String(v.bg ?? '#05070d'));
  },
};
