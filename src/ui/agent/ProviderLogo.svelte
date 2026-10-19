<script lang="ts">
  /**
   * ProviderLogo — 提供商品牌图。
   *
   * 单色字形走 CSS 蒙版 + `currentColor`（跟随主题），带底色的品牌走 `<img>`
   * （保住原色）。见 `provider-logos.ts`。
   *
   * 装饰性图片：`alt` 留空、`aria-hidden` —— 提供商名字永远在旁边，
   * 让它再念一遍品牌名是噪音。
   */
  import { providerLogo } from './provider-logos';

  let { id, size = 16 }: { id: string; size?: number } = $props();

  const logo = $derived(providerLogo(id));
</script>

{#if logo?.mode === 'mask'}
  <span
    class="plogo plogo-mask"
    style={`--plogo-url: url("${logo.url}"); --plogo-size: ${size}px`}
    aria-hidden="true"
    data-testid={`agent-logo-${id}`}
  ></span>
{:else if logo}
  <img
    class="plogo plogo-img"
    src={logo.url}
    alt=""
    style={`--plogo-size: ${size}px`}
    data-testid={`agent-logo-${id}`}
  />
{:else}
  <span
    class="plogo plogo-letter"
    style={`--plogo-size: ${size}px`}
    aria-hidden="true"
    data-testid={`agent-logo-${id}`}
  >{id.slice(0, 1).toUpperCase()}</span>
{/if}

<style>
  /*
   * 显式 fallback：漏写 `--plogo-size` 的后果不是「小一点」，而是 `width: auto`
   * 让 128px 的原图按原尺寸铺开 —— 看起来就像布局坏了，而且不会有任何报错。
   */
  .plogo {
    display: block;
    flex: 0 0 auto;
    width: var(--plogo-size, 16px);
    height: var(--plogo-size, 16px);
  }
  .plogo-mask {
    background: currentColor;
    -webkit-mask: var(--plogo-url) center / contain no-repeat;
    mask: var(--plogo-url) center / contain no-repeat;
  }
  .plogo-img {
    object-fit: contain;
    border-radius: 3px;
  }
  .plogo-letter {
    display: grid;
    place-items: center;
    border-radius: 3px;
    background: var(--surface-3);
    color: var(--text-secondary);
    font-size: calc(var(--plogo-size) * 0.62);
    font-weight: 600;
    line-height: 1;
  }
</style>
