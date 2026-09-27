/**
 * runner.ts — 特效执行器：把 EffectInstance 跑在 ping-pong 链上。
 *
 * 参数求值：基值在 inst.values，曲线在 EffectClip.curves 里以
 * `${instanceId}.${paramKey}` 为键——求值在这里统一做，
 * setUniforms 只收求值好的标量。
 *
 * 反馈类特效（feedback:true，如 echo）：主 pass 读 fb.read 写 fb.write，
 * commit 换手后再把 fb.write 拷到链上——每个特效实例一对历史目标，
 * seek 时由 Renderer.clearFeedback() 清空。
 */

import { evalCurve } from '../core/curve';
import { seedFor } from '../engine/clock';
import type { Kit, Program, Target } from '../engine/kit';
import type { EffectRunner } from '../engine/compositor';
import { EFFECT_HEAD } from './shader-def';
import { getEffect } from './registry';

const PASSTHROUGH = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(u_texture, vUv); }`;

export function createEffectRunner(kit: Kit, projectSeed: () => number): EffectRunner {
  const passProg = kit.quad(PASSTHROUGH, 'fx-passthrough');
  const programs = new Map<string, Program>();

  const programFor = (defId: string, fragment: string): Program => {
    let p = programs.get(defId);
    if (!p) {
      p = kit.quad(EFFECT_HEAD + fragment, `fx-${defId}`);
      programs.set(defId, p);
    }
    return p;
  };

  return (inst, src, dst, ctx) => {
    const entry = getEffect(inst.defId);
    if (!entry) {
      // 未知特效：原样传递（工程向前兼容——新版本加的特效旧版不该毁图）
      passProg.use();
      passProg.tex('u_texture', src.tex);
      kit.pass(passProg, dst);
      return;
    }

    // 求值参数：曲线键 `${instanceId}.${key}`，clipStart/grid 上下文都在 ctx
    const values: Record<string, number | string> = {};
    for (const p of entry.params) {
      const curve = ctx.clip.curves[`${inst.instanceId}.${p.key}`];
      if (curve && p.type === 'range') {
        values[p.key] = evalCurve(curve, ctx.t, { grid: ctx.grid, clipStart: ctx.clip.start });
      } else {
        values[p.key] = inst.values[p.key] ?? p.defaultValue;
      }
    }

    const shader = entry.shader;
    const prog = programFor(inst.defId, shader.fragment);
    const seed = seedFor(projectSeed(), inst.instanceId, ctx.frame) / 4294967296;

    const fb = shader.feedback ? ctx.compositor.feedbackFor(inst.instanceId, ctx.w, ctx.h) : null;

    prog.use();
    prog
      .tex('u_texture', src.tex)
      .u('u_time', ctx.t)
      .u('u_seed', seed)
      .u('u_resolution', [ctx.w, ctx.h]);
    if (fb) prog.tex('u_feedback', fb.read.tex);
    shader.setUniforms(kit.gl, prog.uniforms, values, {
      t: ctx.t,
      frame: ctx.frame,
      seed,
      w: ctx.w,
      h: ctx.h,
      grid: ctx.grid,
      clip: ctx.clip,
    });

    if (fb) {
      // 主 pass 写历史，换手，再把刚写的那份拷到链上。
      const writeTarget: Target = fb.write;
      kit.pass(prog, writeTarget);
      ctx.compositor.feedbackCommit(inst.instanceId);
      passProg.use();
      passProg.tex('u_texture', writeTarget.tex);
      kit.pass(passProg, dst);
    } else {
      kit.pass(prog, dst);
    }
  };
}
