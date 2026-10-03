/**
 * renderer.ts — 对外门面。
 *
 * renderFrame(project, t) 是预览与导出共用的唯一渲染入口（硬约束 1.1：
 * 两者走同一条求值路径，差别只在分辨率——分辨率是 renderer 的状态，
 * 不是参数分支）。导出前 setExportSize，导完 clearExportSize。
 */

import { Compositor, type EffectRunner, type SourceResolver, type TransitionRunner } from './compositor';
import { Kit } from './kit';
import type { SpectrumTextures } from './spectrum-texture';
import { fitPreviewSize, measureDisplaySize } from './preview-size';
import type { Project } from '../core/schema';

export class Renderer {
  readonly kit: Kit;
  private readonly compositor: Compositor;
  private exportSize: { w: number; h: number } | null = null;
  private displayEl: Element | null = null;

  constructor(canvas: HTMLCanvasElement, resolve: SourceResolver, runEffect: EffectRunner) {
    this.kit = new Kit(canvas);
    this.compositor = new Compositor(this.kit, resolve, runEffect);
  }

  setResolver(resolve: SourceResolver): void {
    this.compositor.resolve = resolve;
  }

  setEffectRunner(runEffect: EffectRunner): void {
    this.compositor.runEffect = runEffect;
  }

  /** 转场执行器（`effects/transitions/runner.ts`）。未装配时 compositor 用降级实现。 */
  setTransitionRunner(runTransition: TransitionRunner): void {
    this.compositor.runTransition = runTransition;
  }

  /**
   * 频谱纹理（`u_spectrum`）。由 `render-core` 装配：
   * 主应用供工程音频的频谱，lab 供合成频谱，都没有时照样建 ——
   * 声明了 `u_spectrum` 的特效会读到一张零纹理（静音）而不是未绑定的 sampler。
   */
  setSpectrumTextures(spectrum: SpectrumTextures): void {
    this.compositor.spectrum = spectrum;
  }

  /** 预览画布显示区域的容器元素（量设备像素尺寸用）。 */
  attachDisplay(el: Element): void {
    this.displayEl = el;
  }

  /** 预览尺寸跟随显示区域（适配输出宽高比，永不放大过输出尺寸）。 */
  syncSize(resolution: { w: number; h: number }): void {
    if (this.exportSize) {
      this.kit.size(this.exportSize.w, this.exportSize.h);
      return;
    }
    const display = this.displayEl
      ? measureDisplaySize(this.displayEl)
      : { width: 0, height: 0 };
    const fit = fitPreviewSize(resolution.w, resolution.h, display.width, display.height);
    if (!fit) return;

    /*
     * 预览降质：**只缩后备缓冲，不缩显示尺寸**。
     *
     * 这是用户报的那个「选 25% 画面也跟着变小」的根因：canvas 元素不设 CSS
     * 尺寸时，它的显示尺寸就等于 `width`/`height` 属性（= 后备缓冲的像素数），
     * 所以把缓冲缩到 1/4，画面就真的变成 1/4 大。
     *
     * 正确语义是「**同样的显示面积，用更少的像素去画**」—— 于是这里显式把
     * CSS 盒钉在**未缩放**的适配尺寸上（除以 dpr 换成 CSS px），缓冲照旧缩小。
     * 结果就是用户要的「放大到 100%、有点糊」。
     *
     * 降质不能走 `setExportSize`：那会让上面那行直接 return，窗口缩放、
     * 切工程、改分辨率全都不会再重新适配。
     */
    const s = this.previewScale;
    this.kit.size(
      Math.max(2, Math.round(fit.width * s)),
      Math.max(2, Math.round(fit.height * s)),
    );
    this.applyCanvasCssSize(fit.width, fit.height);
  }

  /**
   * 把 canvas 的 **CSS 盒**固定成适配尺寸（入参是设备像素）。
   *
   * 不这样做的话 CSS 尺寸会跟着后备缓冲走 —— 那正是降质时画面变小的原因。
   * `max-width/height: 100%` 仍然在外层兜着，避免浮点误差顶破容器。
   */
  private applyCanvasCssSize(deviceW: number, deviceH: number): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = `${Math.max(1, Math.round(deviceW / dpr))}px`;
    const cssH = `${Math.max(1, Math.round(deviceH / dpr))}px`;
    const el = this.kit.canvas;
    if (el.style.width !== cssW) el.style.width = cssW;
    if (el.style.height !== cssH) el.style.height = cssH;
  }

  /**
   * 预览质量的缩放系数（1 = 全质）。**只影响预览**：导出走 `setExportSize`，
   * 那条路完全不过这里。默认 1，装配时不需要显式调用。
   */
  private previewScale = 1;

  setPreviewScale(scale: number): void {
    const v = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
    if (v === this.previewScale) return;
    this.previewScale = v;
  }

  getPreviewScale(): number {
    return this.previewScale;
  }

  setExportSize(w: number, h: number): void {
    this.exportSize = { w, h };
    this.kit.size(w, h);
  }

  clearExportSize(): void {
    this.exportSize = null;
  }

  /** 渲染一帧到画布。任何调用方只许传 project 与 t。 */
  renderFrame(project: Project, t: number): void {
    if (!this.exportSize) this.syncSize(project.resolution);
    this.compositor.render(project, t);
  }

  /** seek / 跳帧后调用：清掉所有反馈历史（echo 类特效的暖帧差异是可接受瞬态）。 */
  onSeek(): void {
    this.compositor.clearFeedback();
  }

  /* ---------------------------------------------------------- 导出预热
   *
   * 排版层的位图来自异步光栅化（与 algo 烘焙同构）。预览允许「这一帧缺席」，
   * 但导出不允许 —— 导出是顺序紧循环，缺席就是那一帧真的没有文字。
   * 所以循环里每帧渲染前要 await 一次 prepareFrame。
   *
   * 这不违反硬约束 1.1：1.1 禁止的是「用 rAF 驱动导出」，这里的 await
   * 与已有的 `await sink.submit` 同类（渲染前准备 + 协作式背压），
   * 没有引入第二个时钟。见 ADR-009。
   */

  private prewarmFrameFn: ((p: Project, t: number) => Promise<void>) | null = null;
  private prewarmFontsFn: ((p: Project) => Promise<void>) | null = null;
  private exportEnterFn: (() => void) | null = null;
  private exportExitFn: (() => void) | null = null;

  setPrewarm(fn: ((p: Project, t: number) => Promise<void>) | null): void {
    this.prewarmFrameFn = fn;
  }

  setFontPrewarm(fn: ((p: Project) => Promise<void>) | null): void {
    this.prewarmFontsFn = fn;
  }

  setExportLifecycle(enter: (() => void) | null, exit: (() => void) | null): void {
    this.exportEnterFn = enter;
    this.exportExitFn = exit;
  }

  /** 本帧的文字层预热到当前渲染尺寸。没装排版运行时就是 no-op。 */
  async prepareFrame(project: Project, t: number): Promise<void> {
    await this.prewarmFrameFn?.(project, t);
  }

  /** ADR-003 规则 ③：等字体就绪。必须在导出循环之前调用。 */
  async prewarmFonts(project: Project): Promise<void> {
    await this.prewarmFontsFn?.(project);
  }

  enterExportMode(): void {
    this.exportEnterFn?.();
  }

  exitExportMode(): void {
    this.exportExitFn?.();
  }

  /** 测试钩子：读默认帧缓冲像素。 */
  readPixels(): { data: Uint8Array; w: number; h: number } {
    const gl = this.kit.gl;
    const w = this.kit.w;
    const h = this.kit.h;
    const data = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { data, w, h };
  }
}
