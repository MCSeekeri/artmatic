<script lang="ts">
  /**
   * Mascot — 时间轴右下角的看板娘（彩蛋，可在「设置 → 外观」关掉）。
   *
   * ## 为什么在 `.stage` 里、而不是 `.page`
   *
   * `.stage` 是「预览 + 工具条 + 轨道区」那一格，它的右边界**就是检查器的左边界**
   * ——`.body` 的列是 `minmax(0,1fr) var(--drawer-w)`，抽屉开合时 `.stage` 的宽度
   * 自己跟着变。所以把她挂进 `.stage` 并 `right: 0`，位置就自动「按检查器的宽度
   * 让开」，不需要任何 calc 或 JS。
   *
   * 落点选右下而不是左下，是因为左下是时间轴的**操作区**（轨道名与「添加轨道」
   * 按钮），挡在那里要点一下就够不着；右下全是片段，被挡了缩放一下就能拿到。
   * 代价是排版编辑页里看不到她（那边 `.body` 是 `display:none`）—— 这是好事，
   * 那边是整块画布，多一个东西只会碍事。
   *
   * ## 为什么镜像
   *
   * 原图朝右。站在右下角再朝右就是「背对着整个界面」，镜像之后她朝向画面内部。
   *
   * ## 三个 transform 分在三个元素上
   *
   *   `.mascot`      hover 的躲闪位移（**屏幕坐标**，+x 就是往右）
   *   `.mascot-inner` 镜像 `scaleX(-1)`
   *   `.mascot-img`  点击的挤压回弹（WAAPI）
   *
   * 挤在一处会互相顶掉（WAAPI 的 transform 会盖掉 CSS 的，镜像又会把位移方向
   * 反过来）。分层的代价只是两层 span。
   *
   * ## 闲着的时候不能动
   *
   * 第一版有常驻的上下呼吸，实测**干扰视线**：她就在轨道区边上，任何持续运动会
   * 一直把眼角往那儿拉。现在只有「捏一下」才动。
   */

  import moeUrl from '../../assets/brand/moe.svg?url';
  import { tip } from '../tip';
  import { tr } from '../../i18n/index.svelte';
  import { poke } from './squeak';

  /**
   * 捏下去的四拍：压扁 → 回弹过头 → 收住。
   *
   * 每段的 easing 写在**该段的起点**上：`offset: 0` 那条管 0→0.34（快速下压，
   * ease-out），`offset: 0.34` 那条管回弹，用 `cubic-bezier(0.34, 1.75, 0.5, 1)`
   * —— 控制点的 y 超过 1，就是「弹回来时越过原位再落定」的那一下。
   */
  const SQUASH: Keyframe[] = [
    { transform: 'scale(1, 1)', offset: 0, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    { transform: 'scale(1.1, 0.84)', offset: 0.34, easing: 'cubic-bezier(0.34, 1.75, 0.5, 1)' },
    { transform: 'scale(0.96, 1.06)', offset: 0.72, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { transform: 'scale(1, 1)', offset: 1 },
  ];
  const SQUASH_MS = 460;

  let img: HTMLImageElement;
  let anim: Animation | null = null;

  const label = $derived(tr('app.mascotPoke'));

  function pokeMascot(): void {
    /*
     * 连点时**重来一遍**而不是排队：动画排队的表现是「手停了以后她还在自己
     * 抽动」，而点击本身就是有节奏的输入 —— 重来才是它该有的手感。
     */
    anim?.cancel();
    if (img && !prefersReducedMotion()) {
      anim = img.animate(SQUASH, { duration: SQUASH_MS, fill: 'none' });
    }
    poke();
  }

  /**
   * 系统设了「减少动态效果」时**不做挤压**（躲闪的位移也跟着变成瞬移，见样式里
   * 的媒体查询）。挤压很轻微，但它是「点一下就动」的交互动效，正是这条偏好的
   * 管辖范围 —— 声音不受影响，所以反馈并没有消失。
   */
  function prefersReducedMotion(): boolean {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }
</script>

<button
  type="button"
  class="mascot"
  data-testid="mascot"
  aria-label={label}
  use:tip={{ text: label, placement: 'top' }}
  onclick={pokeMascot}
>
  <span class="mascot-inner">
    <img class="mascot-img" bind:this={img} src={moeUrl} alt="" draggable="false" />
  </span>
</button>

<style>
  .mascot {
    position: absolute;
    /*
     * 贴右下角，但留出「躲闪」的余量：hover 时往右下方挪 4/3 px，落到 2/2 px。
     * 留白取成**大于等于位移**，是为了让两种抽屉状态都成立 —— 抽屉收起时
     * `.stage` 的右边就是窗口右边，没有留白的话躲闪会把她推出屏幕被裁掉。
     */
    right: 0px;
    bottom: 0px;
    width: 85px;
    height: 92px;
    padding: 0;
    z-index: 0;
    /*
     * ⚠️ `background` 不能只写一条 `.mascot { background: none }`。
     * `app.css` 的兜底规则是 `button:hover:not(:disabled) { background: var(--btn-bg-hover) }`
     * —— 特异度 (0,2,1) **高于** `.mascot:hover` 的 (0,2,0)，于是 hover 时会浮出
     * 一块不透明底，她立刻变成「贴上去的一张图」。这里把选择器写成同样的形状
     * （`(0,3,0)`）才压得住。
     */
    background: none;
    border: none;
    cursor: pointer;
    transition: transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
    -webkit-tap-highlight-color: transparent;
  }
  /*
   * hover = 往右下方缩一下，像躲开凑过来的鼠标。位移与底边留白同量级，所以
   * 她只是「往角落里让了让」，不会真的被抽屉或底栏切掉。
   */
  .mascot:hover,
  .mascot:focus-visible {
    transform: translate(4px, 3px);
  }
  .mascot:hover:not(:disabled),
  .mascot:active:not(:disabled) {
    background: transparent;
  }
  .mascot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
  }
  /* 镜像：原图朝右，站在右下角要朝画面里。 */
  .mascot-inner {
    display: block;
    width: 100%;
    height: 100%;
    transform: scaleX(-1);
  }
  .mascot-img {
    display: block;
    width: 100%;
    height: 100%;
    /* 挤压的原点：底边中点 ⇒ scaleY 变小 = 变矮，脚下的位置不动 */
    transform-origin: 50% 100%;
    user-select: none;
    -webkit-user-drag: none;
  }
  @media (prefers-reduced-motion: reduce) {
    /* 位移还在（它是「让开」这件事本身），只是不再有过渡。 */
    .mascot {
      transition: none;
    }
  }
</style>
