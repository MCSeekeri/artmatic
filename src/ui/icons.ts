/**
 * icons.ts — 图标注册表。
 *
 * 用 Lucide 而不是 Font Awesome（项目取向，也是跨项目偏好）：它是描边图标，
 * 与本项目「不加装饰、靠线条与纯色分层」的视觉一致；ISC 许可；按组件导出，
 * 天然 tree-shaking（Font Awesome 整包 CSS 是 ~1MB 的字体 + 全部图标样式）。
 *
 * 用具名**直连**而不是 `import { Icon } from '@lucide/svelte'`：直连让 Vite 少
 * 解析一个万行 barrel 文件，冷启动与 HMR 都更快。代价是不能用别名——所以下面
 * 全部是 `dist/icons/*.svelte` 里存在独立组件的名字（`trash-2`、`vertical-ellipsis`
 * 这类只有 .js 别名的**不能**直连，已改用 `trash` / `ellipsis-vertical`）。
 */

import ArrowDown from '@lucide/svelte/icons/arrow-down';
import ArrowUp from '@lucide/svelte/icons/arrow-up';
import AudioLines from '@lucide/svelte/icons/audio-lines';
import Check from '@lucide/svelte/icons/check';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import Diamond from '@lucide/svelte/icons/diamond';
import Download from '@lucide/svelte/icons/download';
import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
import Eye from '@lucide/svelte/icons/eye';
import EyeOff from '@lucide/svelte/icons/eye-off';
import FlaskConical from '@lucide/svelte/icons/flask-conical';
import Info from '@lucide/svelte/icons/info';
import Keyboard from '@lucide/svelte/icons/keyboard';
import Megaphone from '@lucide/svelte/icons/megaphone';
import MegaphoneOff from '@lucide/svelte/icons/megaphone-off';
import Minimize2 from '@lucide/svelte/icons/minimize-2';
import Moon from '@lucide/svelte/icons/moon';
import Music from '@lucide/svelte/icons/music';
import PanelRight from '@lucide/svelte/icons/panel-right';
import Pause from '@lucide/svelte/icons/pause';
import Pencil from '@lucide/svelte/icons/pencil';
import Play from '@lucide/svelte/icons/play';
import Plus from '@lucide/svelte/icons/plus';
import Save from '@lucide/svelte/icons/save';
import Scissors from '@lucide/svelte/icons/scissors';
import Search from '@lucide/svelte/icons/search';
import Settings from '@lucide/svelte/icons/settings';
import Square from '@lucide/svelte/icons/square';
import Sun from '@lucide/svelte/icons/sun';
import Trash from '@lucide/svelte/icons/trash';
import Video from '@lucide/svelte/icons/video';
import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
import X from '@lucide/svelte/icons/x';

/** 名字 → 组件。新增图标只在这里加一行，调用点写 `name="eye"` 即得类型检查。 */
export const ICONS = {
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'audio-lines': AudioLines,
  check: Check,
  'chevron-right': ChevronRight,
  diamond: Diamond,
  download: Download,
  'ellipsis-vertical': EllipsisVertical,
  eye: Eye,
  'eye-off': EyeOff,
  'flask-conical': FlaskConical,
  info: Info,
  keyboard: Keyboard,
  megaphone: Megaphone,
  'megaphone-off': MegaphoneOff,
  'minimize-2': Minimize2,
  moon: Moon,
  music: Music,
  'panel-right': PanelRight,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  save: Save,
  scissors: Scissors,
  search: Search,
  settings: Settings,
  square: Square,
  sun: Sun,
  trash: Trash,
  video: Video,
  'wand-sparkles': WandSparkles,
  x: X,
} as const;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** 轨道类型的图标：视觉轨用 `video`，音频轨按静音状态给两套。 */
export const TRACK_ICON = {
  visual: { on: 'eye', off: 'eye-off' },
  audio: { on: 'megaphone', off: 'megaphone-off' },
} as const satisfies Record<string, { on: IconName; off: IconName }>;
