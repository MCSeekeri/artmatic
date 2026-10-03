import { floats, NOISE_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 熔融：蜡质下淌 + 不断的黏性软化 + 源图持续渗回来（所以会停在活的平衡态，
 * 而不是把输入埋掉）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `melt`（MIT，见 CREDITS.md）。
 *
 * **本批唯一需要把 `speed` 当「时间倍率」同时乘两处的地方**：上游对带 `speed`
 * 参数的特效给的是 `u_time = ∫speed·dt` **且** `u_delta = dt × speed`，
 * 也就是两者都按 speed 缩放。这里用闭式复现同一件事：
 * `t = u_time * u_speed`、`dt = u_delta * u_speed`。
 * 只乘一个的话，「下淌速度」与「愈合速度」会以不同比例跑，画面就散了。
 *
 * 噪声用共享 `NOISE_GLSL`（与源文件里内联的那份逐字相同，已删掉本地副本）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_speed;
${NOISE_GLSL}
void main() {
  vec3 lum = vec3(0.299, 0.587, 0.114);
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time * u_speed;
  float dt = u_delta * u_speed;

  // --- 下淌场 ---
  // 宽的慢速竖列 × 细密条纹；随时间缓慢游移。
  float cols = fbm(vec2(vUv.x * 4.0, t * 0.05));
  float streaks = fbm(vec2(vUv.x * 47.0 + 13.0, t * 0.021));
  float drip = cols * cols * (0.3 + 0.7 * streaks);

  // 熔融前锋逐列下降，所以滴淌是「长下来」而不是整幅一起滑。
  float front = t * u_amount * (0.02 + 0.3 * cols);
  float meltOn = smoothstep(0.0, 0.18, front - vUv.y);

  // 亮的地方流得快。
  float bright = dot(texture(u_feedback, vUv).rgb, lum);

  // 每帧下落距离（uv 单位），靠 u_delta 做到与帧率无关。
  float fall = dt * u_amount * meltOn
             * (0.05 + 1.6 * drip) * (0.35 + 0.65 * bright) * 0.06;

  // 正在下淌的滴会左右摆；幅度与速度成正比。
  float sway = sin(vUv.y * 21.0 - t * 1.4 + cols * 6.2831) * fall * 2.2;

  // 平流：这个像素接收的是上一帧略靠上的内容（+vUv.y 在特效空间是向下）。
  vec2 from = vec2(clamp(vUv.x + sway, 0.0, 1.0),
                   clamp(vUv.y - fall, 0.0, 1.0));
  vec4 meltedS = texture(u_feedback, from);
  vec3 melted = meltedS.rgb;
  float meltedA = meltedS.a;

  // --- 黏性软化 ---
  // 只在真正流动的地方做：快的滴像蜡一样抹开，没动到的地方保持锐利。
  float visc = 0.7 * clamp(fall / (px.y * 1.5), 0.0, 1.0);
  vec3 up   = texture(u_feedback, clamp(from + vec2(0.0, px.y * 1.5), vec2(0.0), vec2(1.0))).rgb;
  vec3 down = texture(u_feedback, clamp(from - vec2(0.0, px.y * 1.5), vec2(0.0), vec2(1.0))).rgb;
  melted = mix(melted, (melted * 2.0 + up + down) * 0.25, visc);

  // --- 重新凝固 ---
  // 源图不断从蜡里渗回来，熔融于是到达一个活的平衡态。
  vec4 freshS = texture(u_texture, vUv);
  vec3 fresh = freshS.rgb;
  float heal = 1.0 - exp(-mix(2.0, 0.25, u_amount) * dt);
  melted = mix(melted, fresh, heal);
  meltedA = mix(meltedA, freshS.a, heal);

  vec3 col = mix(fresh, melted, meltOn);

  outColor = vec4(clamp(col, 0.0, 1.0), mix(freshS.a, meltedA, meltOn));
}`,
  feedback: true,
  setUniforms: floats('amount', 'speed'),
};
