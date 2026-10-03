import { floats, HUE_ROTATE_GLSL, MATH_GLSL, NOISE_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 纤维位移：把画面沿经纬织纹的走向拉出来，带柱面高光与油膜虹彩。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `fiber-displace`（MIT，见 CREDITS.md）。
 * 本批最大的一个（14 tap + 多种后处理）。
 *
 * 三处照抄会错的：
 * 1. **源文件又声明了一次 `uniform vec2 u_resolution;`** → 删掉（这个坑的第 6 次）。
 * 2. `NOISE_GLSL` 必须是**不掺 seed**那支（它的 `fbm` 是空间织纹，逐帧变会沸腾）。
 *    共享的 `NOISE_GLSL` 已经改成建在 `HASH_PLAIN_GLSL` 上，与此处逐字等价。
 * 3. 高光**不能**从 `fwidth(fiber)` 推 —— 那会在每根纤维的跳变上起尖刺、沿每个格子
 *    边界长出白点。改成按「一根线内的横向位置」解柱面法线。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
uniform float u_density;
uniform float u_comb;
uniform float u_angle;
uniform float u_chrome;
uniform float u_smoothness;

#define FIBER_TAPS 14
${MATH_GLSL}
${NOISE_GLSL}
${HUE_ROTATE_GLSL}
void main() {
  // 在等比校正过的坐标系里干活，织纹的角度才不会被非方形画幅拉歪
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(sin(rad), cos(rad));   // 沿一根线的方向
  vec2 nrm = vec2(dir.y, -dir.x);        // 横跨织纹

  vec2 p = vUv * aspect;
  float across = dot(p, nrm) * u_density;
  float along = dot(p, dir);

  // 丝绸：跨织纹的带限噪声，同时沿线的长度方向漂移，
  // 于是一根纤维的拉力在它自己身上是变化的，而不是一整根一个平值
  float silk = fbm(vec2(across * 0.7, along * 1.7)) * 2.0 - 1.0;

  // 梳散：每根线一个恒定拉力。格子边界用 fwidth 展宽到一个像素，
  // 所以把 density 推高时织纹会化成柔和的颗粒，而不是碎成锯齿彩纸
  float cell = floor(across);
  float aa = clamp(fwidth(across), 0.02, 1.0);
  float w0 = vnoise(vec2(cell * 1.37, along * 1.7)) * 2.0 - 1.0;
  float w1 = vnoise(vec2((cell + 1.0) * 1.37, along * 1.7)) * 2.0 - 1.0;
  float shred = mix(w0, w1, smoothstep(1.0 - aa, 1.0, fract(across)));

  float fiber = mix(shred, silk, u_smoothness);
  float disp = fiber * u_strength * 0.18;

  // 边走边累积，每根线读起来才像「图像沿它的长度被抽出来」而不是一块横移。
  // 三个通道在同一批 tap 上用不同权重曲线：红走满、蓝滞后，所以色边不额外开采样。
  float d = u_chrome * 0.3;
  vec3 centers = vec3(1.0, 1.0 - d * 0.5, 1.0 - d);
  vec3 acc = vec3(0.0);
  vec3 total = vec3(0.0);
  float accA = 0.0;
  float totalA = 0.0;
  for (int i = 0; i < FIBER_TAPS; i++) {
    float t = float(i) / float(FIBER_TAPS - 1);
    vec2 uv = vUv + dir * disp * t;
    vec4 s = texture(u_texture, vec2(bounce(uv.x), bounce(uv.y)));
    vec3 dt = vec3(t) - centers;
    vec3 w = mix(exp(-60.0 * dt * dt), 1.0 - smoothstep(vec3(-0.08), vec3(0.08), dt), u_comb);
    acc += s.rgb * w;
    total += w;
    accA += s.a * w.g;
    totalA += w.g;
  }
  vec3 col = acc / max(total, vec3(1e-4));
  float alpha = accA / max(totalA, 1e-4);

  // 光泽：把每根线当圆柱打光，高光就是沿纤维顺下来的一条平滑亮带。
  // 从 fwidth(fiber) 推会在每根线的跳变上起尖刺、沿格子边界长出锯齿白点。
  float xr = fract(across) * 2.0 - 1.0;
  float nz = sqrt(max(1.0 - xr * xr, 0.0));
  float ndl = clamp(xr * -0.55 + nz * 0.84, 0.0, 1.0);

  // 只有一两个像素宽的线承载不了紧的高光，所以织纹进入亚像素时把它展宽压暗
  float thin = smoothstep(0.15, 0.6, aa);
  float spec = pow(ndl, mix(24.0, 3.0, thin)) * mix(1.0, 0.55, thin);

  spec *= 0.4 + 0.6 * abs(fiber);

  // 虹彩随观察角度偏移，像油膜，而且压在一个窄弧里，相邻线还是一家人的长相。
  // 按每根线随机甩 110° 会把它们散到整个色相环上，那读起来是霓虹塑料。
  float shift = (xr * 0.75 + fiber * 0.25) * 24.0;
  col = hueRotate(col, shift * u_chrome);

  // 光泽不带自己的颜色：它放大这根线已有的颜色，所以受光的纤维保住色相与饱和度，
  // 只是更亮。掺向白色会把整幅织纹洗成粉彩。
  float sh = clamp(spec * u_chrome, 0.0, 1.0);
  col *= 1.0 + sh * 1.6;
  col *= 1.0 - u_chrome * 0.22 * (1.0 - nz) * (1.0 - thin);

  // 按最亮通道做 roll off。逐通道 clamp 会把另外两个压在下面，把峰值去饱和成白 —— 正是刚避开的那个问题
  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.0, 0.0);

  // 把顶到色域边缘的线缓回来。饱和度钉满正是塑料感的另一半，上面的乘法会把颜色推过去，
  // 这里只碰最过分的那批
  float lo = min(min(col.r, col.g), col.b);
  float sat = max(max(col.r, col.g), col.b) - lo;
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(grey), smoothstep(0.6, 1.0, sat) * 0.3 * u_chrome);

  outColor = vec4(clamp(col, 0.0, 1.0), alpha);
}`,
  linearFilter: true,
  setUniforms: floats('strength', 'density', 'comb', 'angle', 'chrome', 'smoothness'),
};
