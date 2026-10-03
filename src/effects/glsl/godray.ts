import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 体积光：沿光照方向做周期 Perlin 湍流，叠一层会飘的雾气。
 *
 * 移植自 openmosh `lab/shaders/pixi/Godray.fs`，
 * 上游是 PixiJS 的 `GodrayFilter`（parallel 模式）的 ISF 端口（MIT，见 CREDITS.md）。
 *
 * 两处口径换算：
 * - ISF 的 `TIME` 是**秒**，Artmatic 的 `u_time` 也是秒 —— 但这个特效有 `speed`
 *   参数（`TIME * speed`），所以直接 `u_time * u_speed` 就对了，**不需要**
 *   openmosh 那套相位折算（那些 shader 的 `u_time` 是累积相位，ISF 的不是）。
 * - `isf_FragNormCoord` → `vUv`；`RENDERSIZE` → `u_resolution`；`IMG_NORM_PIXEL` → `texture`。
 *
 * `pnoise` 是 Ashima 的经典 3D Perlin（周期版），只这个特效用，所以**留在本地**
 * 而不是塞进共享头 —— 共享头里放只有一个人用的东西，下次改的人会以为它被广泛依赖。
 *
 * alpha 按项目惯例**保留链输入的覆盖**而不是写死 1.0（与 `glow` 同一做法）：
 * 在不透明素材上完全一致，但在文字层上不会把整帧填满。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_angle;
uniform float u_gain;
uniform float u_lacunarity;
uniform float u_alpha;
uniform float u_speed;
uniform float u_fade;

vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fadev(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float pnoise(vec3 P, vec3 rep) {
  vec3 Pi0 = mod(floor(P), rep);
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
  Pi0 = mod289v3(Pi0);
  Pi1 = mod289v3(Pi1);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fadev(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
}

float turb(vec3 P, vec3 rep, float lacunarity, float gain) {
  float sum = 0.0;
  float sc = 1.0;
  float totalGain = 1.0;
  for (float i = 0.0; i < 6.0; i++) {
    sum += totalGain * pnoise(P * sc, rep);
    sc *= lacunarity;
    totalGain *= gain;
  }
  return abs(sum);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  float a = radians(u_angle);
  float d = cos(a) * vUv.x + sin(a) * vUv.y * aspect;
  float t = u_time * u_speed;
  float noise = turb(vec3(d, d, 0.0) + vec3(t, 0.0, 62.1 + t) * 0.05,
                     vec3(480.0, 320.0, 480.0), u_lacunarity, u_gain);
  noise = mix(noise, 0.0, 0.3);
  float mist = noise * mix(1.0, 1.0 - vUv.y, u_fade) * u_alpha;
  vec4 src = texture(u_texture, vUv);
  outColor = vec4(src.rgb + vec3(mist), clamp(max(src.a, mist), 0.0, 1.0));
}`,
  setUniforms: floats('angle', 'gain', 'lacunarity', 'alpha', 'speed', 'fade'),
};
