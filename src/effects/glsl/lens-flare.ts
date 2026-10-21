import {
  colors,
  compose,
  floats,
  HSV_GLSL,
  HASH_FAST_GLSL,
  ints,
  selectInt,
  type EffectShaderDef,
} from '../shader-def';

/**
 * 镜头光晕：亮部提取 → 沿「光心——画面中心」轴排布光斑 → 加性合成。
 *
 * ## 自动模式为什么要 pre-pass
 *
 * 「最亮的区域」是一个**全局归约**，单个 fragment 算不出来（fragment 里看不到
 * 别的像素）。所以走一环 pre-pass：把全图按 32×32 格扫一遍（每格 3×3 个采样点，
 * 取均值 —— 单点会锁到一颗热噪上），选最亮的一格，再在这格附近做 16×16 的
 * 加权质心细化。结果写进**像素 (0,0)**，主 pass 用 `texelFetch` 取。
 *
 * 只有 `gl_FragCoord == (0,0)` 那个片元真的做这件事，其余片元在函数开头就返回。
 * 这不是省事，是必要的：全屏 9216 次采样会让它变成整条链里最贵的一环，
 * 而分支条件是逐 warp 一致的，跳过的代价只有光栅化。
 *
 * 已知限度：网格是**点采样**，画面里小于约 1/32 画面宽的高光只有当它刚好落在
 * 采样点上才会被选中；命中不到时 flare 落在最近的一格上（视觉上就是偏几十像素）。
 * 真实素材里的太阳 / 灯泡不是这种尺度。
 *
 * 手动模式下这一环照跑（pre-pass 是静态声明，跑不跑由不得模式），代价是
 * 一次全屏 draw 加一个片元里的采样 —— 可以接受，不值得为它加一套条件 pre-pass。
 *
 * ## 分量共享 + 样式只改权重
 *
 * 九种样式不是九套着色器，而是同一组分量（光球 / 拉丝 / 星芒 / 环 / 六边形 /
 * 鬼影 / 雾霾）的**权重向量**不同。样式分支全在 uniform 上，不产生 warp 分歧。
 *
 * ## 与 `ghosting` 的区别
 *
 * `ghosting` 是把**画面本身**缩放错位叠几层（拖影）；这里是往画面上**加光**，
 * 几何位置由光源决定，与画面内容无关。两者可以串着用。
 *
 * ## u_time
 *
 * 只有星芒的旋转用它，写成 `u_time * u_spin` 的闭式 —— 没有累积相位
 * （硬约束 1.1，见 `effects/AGENTS.md`）。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    {
      fragment: `
uniform float u_threshold;

float lfLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  // 只有一个片元干活，其余立刻退出。
  if (gl_FragCoord.x > 0.5 || gl_FragCoord.y > 0.5) { outColor = vec4(0.0); return; }

  const int COARSE = 32;
  const int SUB = 3;
  const int FINE = 16;

  float inv = 1.0 / float(COARSE);
  float best = -1.0;
  vec2 bestUv = vec2(0.5);

  for (int cy = 0; cy < COARSE; cy++) {
    for (int cx = 0; cx < COARSE; cx++) {
      vec2 base = vec2(float(cx), float(cy)) * inv;
      float acc = 0.0;
      for (int sy = 0; sy < SUB; sy++) {
        for (int sx = 0; sx < SUB; sx++) {
          vec2 uv = base + (vec2(float(sx), float(sy)) + 0.5) / float(SUB) * inv;
          acc += lfLuma(texture(u_texture, uv).rgb);
        }
      }
      acc /= float(SUB * SUB);
      if (acc > best) { best = acc; bestUv = base + 0.5 * inv; }
    }
  }

  // 在最亮那格附近 ±1.5 格做加权质心：w 的四次方把权重压在近峰值处，
  // 既得到亚格精度，又不会被同格里的暗部把光心拖走。
  vec2 sum = vec2(0.0);
  float sumW = 0.0;
  for (int y = 0; y < FINE; y++) {
    for (int x = 0; x < FINE; x++) {
      vec2 off = (vec2(float(x), float(y)) + 0.5) / float(FINE) - 0.5;
      vec2 uv = bestUv + off * 3.0 * inv;
      float w = max(0.0, lfLuma(texture(u_texture, uv).rgb) - u_threshold);
      w *= w;
      w *= w;
      sum += uv * w;
      sumW += w;
    }
  }

  // 整幅暗到没有超过阈值的像素时退回画面中心（此时 flare 强度也接近 0）。
  vec2 pos = sumW > 1e-6 ? sum / sumW : vec2(0.5);
  outColor = vec4(pos, best, 1.0);
}`,
      linearFilter: true,
    },
  ],

  fragment: `
${HSV_GLSL}
${HASH_FAST_GLSL}

uniform int   u_mode;
uniform int   u_style;
uniform int   u_ghosts;
uniform int   u_points;
uniform float u_intensity;
uniform float u_size;
uniform float u_spread;
uniform float u_rainbow;
uniform float u_spin;
uniform vec3  u_tint;
uniform float u_x1;
uniform float u_y1;
uniform float u_x2;
uniform float u_y2;
uniform float u_x3;
uniform float u_y3;

struct Weights {
  float core;
  float glow;
  float streak;
  float star;
  float ring;
  float hex;
  float ghost;
  float veil;
  float rim;
  float gscale;
};

float lfLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// 六边形 SDF，r 是内切半径。光圈叶片的边就是它。
float lfHex(vec2 p, float r) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

float lfDisc(float x, float r) {
  float t = x / max(r, 1e-5);
  return exp(-pow(t, 6.0));
}

float lfRim(float x, float r) {
  float e = max(r * 0.16, 1e-5);
  return exp(-pow(abs(x - r) / e, 2.0));
}

// 一个鬼影的形状：实心盘 + 偏亮的边（真实镜片反光两者都有），rim 决定偏向哪边。
float lfGhost(float x, float r, float rim) {
  return lfDisc(x, r) * (1.0 - 0.65 * rim) + lfRim(x, r) * (0.3 + 0.7 * rim);
}

Weights styleWeights() {
  Weights w;
  w.core = 1.0; w.glow = 0.85; w.streak = 0.0; w.star = 0.0;
  w.ring = 0.0; w.hex = 0.0; w.ghost = 0.0; w.veil = 0.2; w.rim = 0.0; w.gscale = 1.0;

  if (u_style == 1) {          // 横向拉丝
    w.core = 0.55; w.glow = 0.3; w.streak = 1.0; w.veil = 0.15;
  } else if (u_style == 2) {   // 星芒
    w.core = 0.9; w.glow = 0.45; w.star = 1.0; w.ring = 0.12;
  } else if (u_style == 3) {   // 环形光圈
    w.core = 0.45; w.glow = 0.3; w.ring = 1.0; w.ghost = 0.25;
  } else if (u_style == 4) {   // 经典鬼影
    w.core = 0.4; w.glow = 0.28; w.ghost = 1.0; w.ring = 0.2;
  } else if (u_style == 5) {   // 六边形光圈
    w.core = 0.45; w.glow = 0.3; w.hex = 1.0; w.ghost = 0.4; w.rim = 0.5; w.gscale = 1.3;
  } else if (u_style == 6) {   // 光谱色散
    w.core = 0.35; w.glow = 0.25; w.ghost = 1.0; w.ring = 0.3;
  } else if (u_style == 7) {   // 雾霾眩光
    w.core = 0.25; w.glow = 0.9; w.veil = 2.4; w.ghost = 0.15;
  } else if (u_style == 8) {   // 光斑链
    w.core = 0.25; w.glow = 0.2; w.ghost = 1.0; w.rim = 1.0; w.gscale = 1.6;
  }
  return w;
}

// 一个光源的全部光学分量。strength 是「这个光有多亮」（自动模式取该点亮度）。
vec3 lfFlare(vec2 uv, vec2 light, float strength, out float cov) {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 q = (uv - light) * vec2(aspect, 1.0);
  float d = max(length(q), 1e-5);
  float s = max(u_size, 0.05);
  Weights w = styleWeights();
  // 光谱色散那一档把色散拉满，其余跟着滑杆。
  float rainbow = u_style == 6 ? 1.0 : u_rainbow;

  float core = exp(-d * d / (s * s * 0.006));
  float glow = exp(-d / (s * 0.16)) * 0.35 + 0.3 / (1.0 + d * d / (s * s * 0.03));

  float streak = exp(-abs(q.x) / (s * 0.55))
               * (exp(-abs(q.y) / (s * 0.01 + 0.0015))
                  + 0.22 * exp(-abs(q.y) / (s * 0.07 + 0.004)));

  float ang = atan(q.y, q.x) + u_time * u_spin;
  float rays = pow(abs(cos(ang * 3.0)), 40.0) + 0.45 * pow(abs(cos(ang * 3.0 + 0.5236)), 90.0);
  rays *= exp(-d / (s * 0.5)) * 0.6;

  float ring = exp(-abs(d - s * 0.55) / (s * 0.018 + 0.0015)) * 0.4
             + exp(-abs(d - s * 1.05) / (s * 0.03 + 0.002)) * 0.14;

  float hexRing = exp(-abs(lfHex(q, s * 0.42)) / (s * 0.02 + 0.0015)) * 0.45
                + 0.16 * exp(-abs(lfHex(q, s * 0.68)) / (s * 0.03 + 0.002));

  float veil = 0.16 / (1.0 + d * 4.0);

  // 鬼影沿「光心 → 画面中心」的轴排布：k 从光源内侧一直排到中心对面。
  vec3 ghosts = vec3(0.0);
  if (u_ghosts > 0) {
    vec2 axis = vec2(0.5) - light;
    float n = float(u_ghosts);
    for (int i = 0; i < 8; i++) {
      if (i >= u_ghosts) break;
      float fi = float(i);
      float k = mix(-0.3, 1.4, (fi + 0.5) / n) * u_spread;
      vec2 gp = (vec2(0.5) + axis * k - light) * vec2(aspect, 1.0);
      float gd = length(q - gp);
      float gr = s * w.gscale * (0.025 + 0.09 * hash11(fi * 3.17 + 1.3));
      vec3 gcol;
      gcol.r = lfGhost(gd * (1.0 + 0.12 * rainbow), gr, w.rim);
      gcol.g = lfGhost(gd, gr, w.rim);
      gcol.b = lfGhost(gd * (1.0 - 0.12 * rainbow), gr, w.rim);
      vec3 gc = mix(u_tint, hsv2rgb(vec3(fract(0.02 + fi * 0.13), 0.65, 1.0)), rainbow);
      ghosts += gcol * gc * (0.45 * (1.0 - 0.55 * (fi + 0.5) / n));
    }
  }

  vec3 f = u_tint * (core * w.core + glow * w.glow + streak * w.streak + rays * w.star)
         + u_tint * (ring * w.ring + hexRing * w.hex + veil * w.veil)
         + ghosts * w.ghost;
  f *= strength;
  cov = clamp(lfLuma(f) * 2.0, 0.0, 1.0);
  return f;
}

void main() {
  vec4 src = texture(u_original, vUv);
  vec3 acc = vec3(0.0);
  float cov = 0.0;

  if (u_mode == 1) {
    vec2 pts[3];
    pts[0] = vec2(u_x1, 1.0 - u_y1);
    pts[1] = vec2(u_x2, 1.0 - u_y2);
    pts[2] = vec2(u_x3, 1.0 - u_y3);
    for (int i = 0; i < 3; i++) {
      if (i >= u_points) break;
      float c2 = 0.0;
      acc += lfFlare(vUv, pts[i], 1.0, c2);
      cov = max(cov, c2);
    }
  } else {
    // xy = 光心 uv，z = 该处的亮度（pre-pass 写在像素 (0,0)）。
    vec4 det = texelFetch(u_texture, ivec2(0), 0);
    float strength = clamp(lfLuma(texture(u_original, det.xy).rgb) * 2.2, 0.5, 1.7);
    acc = lfFlare(vUv, det.xy, strength, cov);
  }

  // 加性合成，但按「这个通道还剩多少余量」收缩：intensity = 0 时严格恒等。
  vec3 outRgb = src.rgb + acc * u_intensity * (vec3(1.0) - src.rgb * 0.55);
  outColor = vec4(outRgb, clamp(max(src.a, cov * min(u_intensity, 1.0)), 0.0, 1.0));
}`,

  setUniforms: compose(
    selectInt('mode', { auto: 0, manual: 1 }),
    selectInt('style', {
      soft: 0,
      streak: 1,
      star: 2,
      ring: 3,
      ghost: 4,
      hex: 5,
      spectral: 6,
      veil: 7,
      bokeh: 8,
    }),
    ints('ghosts', 'points'),
    floats('intensity', 'size', 'threshold', 'spread', 'rainbow', 'spin', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3'),
    colors('tint'),
  ),
};
