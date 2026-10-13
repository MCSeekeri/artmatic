<script lang="ts">
  /**
   * 文字阴影图标（自绘）。
   *
   * Lucide 里没有「带阴影的字」，而这是 Office 里一个固定字形：一个字母 A
   * 加它右下角的重影。用 `sun` / `sparkles` 之类凑合会让人以为那是「发光」
   * 或「特效」，反而更含糊。
   *
   * 重影用 `opacity` 而不是灰色：颜色必须跟随 `currentColor`（hover 变主题色
   * 时整个图标要一起变）。
   *
   * 形态约定与 Lucide 一致：24×24 viewBox、描边、`currentColor`、无填充。
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
  <!-- 重影（右下偏移 + 半透明） -->
  <path d="M9.5 19 L13 6 L16.5 19" opacity="0.4" />
  <!-- 主字形 -->
  <path d="M8 17 L11.5 4 L15 17" />
  <path d="M9.5 12.5 H13.5" />
</svg>
