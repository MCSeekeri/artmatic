<script lang="ts">
  /**
   * 字符间距图标（自绘）。
   *
   * Lucide 没有这个形状，而它是 Office 的固定字形：「AV」两个字母下面一支
   * 双向箭头 —— 表达的是「字与字之间的距离」。用 `move-horizontal` 之类的
   * 通用箭头代替，用户认不出来这是干什么的。
   *
   * 形态约定与 Lucide 一致：24×24 viewBox、描边、`currentColor`、无填充。
   * 这些属性是**必须**的 —— `Icon.svelte` 靠它们把尺寸与颜色交给图标。
   */
  interface Props {
    size?: number;
    strokeWidth?: number;
    'aria-label'?: string;
    'aria-hidden'?: boolean;
  }
  const { size = 24, strokeWidth = 2, ...rest }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  {...rest}
>
  <!-- A -->
  <path d="M3 12 L6.5 3 L10 12" />
  <path d="M4.5 9 H8.5" />
  <!-- V -->
  <path d="M14 3 L17.5 12 L21 3" />
  <!-- 双向箭头 -->
  <path d="M4 18.5 H20" />
  <path d="M4 18.5 L6.5 16.5" />
  <path d="M4 18.5 L6.5 20.5" />
  <path d="M20 18.5 L17.5 16.5" />
  <path d="M20 18.5 L17.5 20.5" />
</svg>
