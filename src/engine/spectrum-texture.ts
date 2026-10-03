/**
 * spectrum-texture.ts — 把「某一帧的频谱数据」变成能绑给 `u_spectrum` 的纹理。
 *
 * 为什么单独一层：`render-core` 刻意**不** import `audio/`（免得把整条音频链路
 * 拖进 lab 的 bundle），而 `audio/` 也不该知道 WebGL。所以数据以 `SpectrumSource`
 * 注入进来，**GL 侧（纹理与上传）留在这里**。两边都不知道对方的实现。
 *
 * **每实例一张纹理**：平滑是特效上的一个参数，两个律动条实例完全可以对同一帧
 * 音频要不同的平滑，所以不能共用一张（上游同样如此）。
 */

import type { Kit, Program } from './kit';

export interface SpectrumSource {
  /**
   * 某一实例在这一帧的频谱：**已做滚动归一化、并按实例包络平滑过**，
   * 0..255，长度 = bin 数。`null` = 没有音频或还没算好。
   *
   * 返回的缓冲**只在下次调用前有效**（内部复用），拿到就上传，不要留着。
   */
  frameFor(instanceId: string, t: number, dt: number, smoothing: number): Uint8Array | null;
}

/**
 * 平滑参数在 values bag 里的键名。**这是协议的一部分**（与上游一致）：
 * 只有声明了 `u_spectrum` 的视觉特效会走到这里，而它们的平滑参数都叫 `smoothing`。
 */
const SMOOTHING_KEY = 'smoothing';
/** 与 `audio/auto-range.ts` 的 `DEFAULT_AUDIO_RESPONSE.smoothing` 一致。 */
const DEFAULT_SMOOTHING = 0.45;

function makeTexture(gl: WebGL2RenderingContext, w: number, bytes: Uint8Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // 单通道：着色器只读 `.r`。宽度是任意值（1025），所以 UNPACK_ALIGNMENT=1
  // 必须在上下文初始化时就设好 —— kit.ts 已经设了。
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, 1, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  // NEAREST 是有意的：消费方（律动条）在一根 bar 覆盖的 bin 跨距上取 8 个 tap 的
  // **最大值**，相邻 bin 之间插值在那里没有意义，反而会糊掉低频段
  // （那里 bin 在频率轴上离得最远）。
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

interface Entry {
  tex: WebGLTexture;
  w: number;
}

export class SpectrumTextures {
  private source: SpectrumSource | null = null;
  private readonly perInstance = new Map<string, Entry>();
  /**
   * 没有数据时绑这张 1×1 的零纹理：着色器读回 0（= 静音），
   * 而不是让 sampler 停在未绑定状态 —— 那是 GL 的未定义行为。
   */
  private readonly silent: WebGLTexture;
  /**
   * 上传用的 scratch 纹理单元。
   *
   * **`texSubImage2D` 作用在「当前激活的纹理单元」绑着的纹理上**，而 `Program.tex()`
   * 依次把采样本绑到 0..n 并留下最后一个为激活态 —— 直接 `bindTexture` 上传就会
   * 把某一个 sampler 指向频谱纹理。真实事故：`audio-bars` 的 `u_original` 没被用到、
   * 被编译器优化掉，于是 `tex()` 提前返回（**texUnit 不递增**），激活单元停在 0
   * （`u_texture`）—— 频谱纹理把链输入换掉了，画面变成一片红色竖线
   * （R8 读作 rgba = (r, 0, 0, 1)：红、不透明、竖直、随频谱跳动）。
   *
   * 取「合并单元数的最后一个」而不是某个硬编码下标：片元 sampler 只能用
   * `0..MAX_TEXTURE_IMAGE_UNITS-1`，而 combined ≥ 那个值，所以最后一个是安全的。
   * 这样上传与采样器绑定的**先后顺序就无所谓**了。
   */
  private readonly scratchUnit: number;

  constructor(private readonly kit: Kit) {
    const gl = kit.gl;
    const max = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;
    this.scratchUnit = Math.max(0, (max || 16) - 1);
    this.silent = makeTexture(gl, 1, new Uint8Array([0]));
  }

  setSource(source: SpectrumSource | null): void {
    this.source = source;
  }

  /** 实例消失时释放它的纹理（不然这个 Map 会跟着工程一直长）。 */
  drop(instanceId: string): void {
    const e = this.perInstance.get(instanceId);
    if (e) {
      this.kit.gl.deleteTexture(e.tex);
      this.perInstance.delete(instanceId);
    }
  }

  /** 全清：工程切换、卸载。 */
  clear(): void {
    const gl = this.kit.gl;
    for (const e of this.perInstance.values()) gl.deleteTexture(e.tex);
    this.perInstance.clear();
  }

  /**
   * program 声明了 `u_spectrum` 就把它绑上；没声明就什么都不做
   * （绝大多数特效走的是这条路径，所以这个调用是廉价的）。
   */
  bindTo(
    prog: Program,
    instanceId: string,
    t: number,
    dt: number,
    values: Record<string, number | string>,
  ): void {
    if (!prog.uniforms['u_spectrum']) return;
    const smoothing =
      typeof values[SMOOTHING_KEY] === 'number' ? values[SMOOTHING_KEY] : DEFAULT_SMOOTHING;
    const bytes = this.source?.frameFor(instanceId, t, dt, smoothing) ?? null;
    if (!bytes || bytes.length === 0) {
      prog.tex('u_spectrum', this.silent);
      return;
    }
    let entry = this.perInstance.get(instanceId);
    if (!entry || entry.w !== bytes.length) {
      if (entry) this.kit.gl.deleteTexture(entry.tex);
      entry = { tex: makeTexture(this.kit.gl, bytes.length, bytes), w: bytes.length };
      this.perInstance.set(instanceId, entry);
      prog.tex('u_spectrum', entry.tex);
      return;
    }
    const gl = this.kit.gl;
    // 上传走 scratch 单元 —— 绝不能碰采样器正在用的那几个（见 scratchUnit 的注释）。
    gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, entry.w, 1, gl.RED, gl.UNSIGNED_BYTE, bytes);
    // `prog.tex()` 自己会设 activeTexture，所以这里不需要还原。
    prog.tex('u_spectrum', entry.tex);
  }
}
