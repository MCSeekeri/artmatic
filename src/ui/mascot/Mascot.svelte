<script lang="ts">
  /**
   * Mascot — 时间轴右下角的看板娘（彩蛋，可在「设置 → 外观」关掉）。
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
  /*
   * 右下角**贴死**（0 留白）。这是刻意的出血：hover 的躲闪位移 (4px, 3px) 会把
   * 右/下两条边推出 `.stage` 边界，被抽屉 / 底栏 / 视口吃掉一部分 —— 看起来才
   * 像「往角落里缩头」。若留白 ≥ 位移，她全程都在屏幕内，同一个位移只会读成
   * 「平移」。`mascot.spec` 里「躲完不出界」的断言已按这个语义删掉，
   * **不要再加回来**。
   */
  .mascot {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 85px;
    height: 92px;
    padding: 0;
    z-index: 0;
    background: none;
    border: none;
    cursor: pointer;
    transition: transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
    -webkit-tap-highlight-color: transparent;
  }
  /*
   * hover = 往右下方缩一下，像躲开凑过来的鼠标。常态贴角 ⇒ 这一下会把右下
   * 边缘推出去 4/3px，正好被抽屉 / 底栏 / 视口的边缘裁掉 —— 「缩头」的观感
   * 就来自这里，**不要**为了「不出界」把它调回去。
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
