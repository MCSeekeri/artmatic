<script lang="ts">
  /**
   * Icon — 图标渲染的唯一入口。
   *
   * 存在意义是让调用点写 `name="eye"` 而不是在 svelte 文件顶部 import 一堆组件；
   * 名字因此可被类型检查（IconName 是 ICONS 的键），写错就编译报错。
   *
   * 颜色刻意**不设默认值**：Lucide 默认 `stroke="currentColor"`，于是图标自动
   * 跟随父元素的 `color`。这正是「纯图标按钮 hover 只变图标颜色」得以成立的前提。
   */
  import { ICONS, type IconName } from './icons';

  interface Props {
    name: IconName;
    /** 边长（px）。取 --icon-sm/--icon-md 对应的 13 / 15 居多。 */
    size?: number;
    /** 描边粗细。默认 1.75 比 Lucide 自带的 2 细一点，密集界面里更干净。 */
    stroke?: number;
    /** 无障碍名。纯装饰图标不要传——不传就会自动 aria-hidden。 */
    label?: string;
  }
  const { name, size = 14, stroke = 1.75, label }: Props = $props();

  const Cmp = $derived(ICONS[name]);
</script>

<Cmp size={size} strokeWidth={stroke} aria-label={label} aria-hidden={label ? undefined : true} />
