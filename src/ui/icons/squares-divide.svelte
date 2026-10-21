<script lang="ts">
  /**
   * 拆分（分割）图标（自绘）。
   *
   * Lucide 的布尔运算四件套（`squares-unite` / `-subtract` / `-intersect` /
   * `-exclude`）里没有「拆分」。这个图标由三块组成，对应拆分的结果：
   *
   *  - 左上、右下两片 L 形：`squares-subtract` 的实线部分与它绕中心旋转 180°
   *    的副本（两片合起来正好是 `squares-exclude` 的轮廓）；
   *  - 中间一个**空心**小方块：重叠区域被单独切出来，而且它也是一个独立对象
   *    （空心 = 路径，而不是 `intersect` 那种实心块）。
   *
   * 三块之间留 1.5 个单位的缝：拆分的结果是**彼此分离**的图形。若贴着画，
   * 16px 下会和 `squares-exclude` 糊成一团。
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

  /** `squares-subtract` 的实线部分（左上 L 形）。 */
  const L =
    'M16 4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-5a2 2 0 0 1 2-2h5a1 1 0 0 1 1-1z';
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
  <!-- 左上 L -->
  <path d={L} />
  <!-- 右下 L：同一形状绕中心转 180° -->
  <path d={L} transform="rotate(180 12 12)" />
  <!-- 中间的空心方块（重叠区，独立成块） -->
  <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
</svg>
