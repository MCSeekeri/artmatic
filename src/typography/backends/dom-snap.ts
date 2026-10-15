/**
 * backends/dom-snap.ts — snapDOM 后端。
 *
 * 与 ADR-003 的关系：
 *  - 规则 ① 字体子集化：不在这里做，由 FontProvider 在 ensure() 阶段把
 *    （子集化后的）字体字节备成 data URL，这里只负责交给 snapDOM。
 *  - 规则 ② 不用 embedFonts:false 换性能：恒为 true / 'auto'。
 *  - 规则 ③ 导出前 await document.fonts.ready：FontProvider.ensure() 内部做。
 *  - 规则 ④ 动画状态要烘焙：bakeAnimations()。
 *
 * snapDOM 3.x 的真实 API（不是文档里那版）：
 *  - `embedFonts` 是 `boolean | 'auto'`，**不是 CSS 字符串**；
 *  - 字体素材走 `localFonts: {family, src}[]`（官方注释：
 *    「Provide fonts explicitly to avoid remote discovery」）；
 *  - 输出尺寸走 `width` / `height`（绝对尺寸），`scale` 只在二者都没给时生效；
 *  - `dpr` 默认是 `devicePixelRatio` —— **不显式给 1 的话，同样的代码在
 *    2K 屏上产出两倍像素**，预览与导出对不上，而且换台机器才复现。
 */

import { snapdom } from '@zumer/snapdom';
import { animationSpecs, bakeAnimations } from '../bake-animation';
import type { FontProvider } from '../font-provider';
import { buildDocDom } from '../render-dom';
import type { RasterRequest, TextRasterizer } from '../rasterizer';

export class DomSnapRasterizer implements TextRasterizer {
  readonly id = 'dom-snap' as const;

  /**
   * 光栅化**串行链**。
   *
   * 后端在逻辑上是无状态的（不持有缓存），但它有一份**共享可变状态：`host`**——
   * 每次 `rasterize` 都把新文档 `replaceChildren` 进去，截完再清空。而
   * `snapdom()` + `toCanvas()` 是异步的，于是**两次并发调用会互相把对方的
   * root 从文档里摘掉**：脱离文档的元素既拿不到 CSSAnimation（`bakeAnimations`
   * 失效），`getComputedStyle` 也回落到空值 —— 截出来是一张**全透明或全不透明黑**
   * 的废图，而且**不报错**。
   *
   * 后果不是「这一帧糊一下」：`TypographyRuntime` 会把废图**按正确的键**缓存下来，
   * 静态文档的键不含帧号 ⇒ 这条坏图会一直生效到被淘汰，表现成「某一层排版把
   * 下面整幅画面涂黑 / 凭空消失」，重启预览服务器只是重跑一次同样的竞态。
   *
   * 谁会并发：`rasterize` 的调用方有三处 —— rAF 预览的 `schedule`、
   * 导出的 `prewarmFrame`（`Promise.all`，天然并发）、编辑器的 `rasterizeOnce`。
   * 它们互相之间没有任何串行化，所以这条链必须放在**拥有 host 的这一层**：
   * 谁持有共享状态，谁负责保证「同一时刻只有一次截图」。
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: HTMLElement,
    private readonly fonts: FontProvider,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  rasterize(req: RasterRequest): Promise<HTMLCanvasElement> {
    const run = this.chain.then(() => this.rasterizeOne(req));
    // 链上只关心「上一单结束了」：一单失败不能把后续全部拖死。
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async rasterizeOne(req: RasterRequest): Promise<HTMLCanvasElement> {
    // ADR-003 规则 ③：字体没就绪就截图，首帧会用回落字体量度。
    await this.fonts.ensure(req.doc);

    const root = buildDocDom(req.doc, {
      forRaster: true,
      resolveImage: req.resolveImage,
      isImageOffline: req.isImageOffline,
      offlineLabel: req.offlineLabel,
      customThemes: req.customThemes,
    });
    this.host.replaceChildren(root);
    try {
      // 必须挂进文档之后才能 seek（脱离文档的元素拿不到 CSSAnimation）。
      bakeAnimations(root, animationSpecs(req.doc), req.localSec);

      const localFonts = this.fonts.localFonts(req.doc);
      const result = await snapdom(root, {
        width: req.width,
        height: req.height,
        dpr: 1,
        // 透明底。PNG 的默认值本来就是 null，写出来是为了钉死这条约定：
        // 排版层要叠到画面上，自带不透明底会把下面的东西整个盖掉。
        backgroundColor: null,
        embedFonts: localFonts ? true : 'auto',
        localFonts,
        // 本项目零阴影；显式关掉，免得 root 的 outline / drop-shadow
        // 把捕获框撑大，导致输出尺寸与请求的 width/height 不一致。
        outerShadows: false,
        // 每次都是「新的一帧」，不能让 snapDOM 复用上一次的捕获结果。
        cache: 'disabled',
      });

      return await result.toCanvas({ width: req.width, height: req.height, dpr: 1 });
    } finally {
      this.host.replaceChildren();
    }
  }

  dispose(): void {
    this.host.replaceChildren();
  }
}
