import type { ParamDef } from '../types';

export const id = 'lcd';
export const nameKey = 'fx.lcd';
export const params: ParamDef[] = [
  // 距离 1 = 屏幕正好铺满取景框（颗粒刚好处在「看不见」的边缘）；
  // 越小越靠近，画面放大、颗粒变粗。上限刻意卡在 1：越过它就是屏幕边缘与黑边，
  // 不是这个滤镜要讲的事。
  { key: 'distance', labelKey: 'fx.lcd.distance', type: 'range', min: 0.2, max: 1, step: 0.01, defaultValue: 0.5 },
  // 相机位置：屏幕中心对准内容上的哪一点（内容坐标，0.5 是正中央）。
  // 与「距离」独立 —— 拉近之后靠它取景，比先拉远再挪更方便。
  { key: 'panX', labelKey: 'fx.lcd.panX', type: 'range', min: -0.5, max: 0.5, step: 0.005, defaultValue: 0 },
  { key: 'panY', labelKey: 'fx.lcd.panY', type: 'range', min: -0.5, max: 0.5, step: 0.005, defaultValue: 0 },
  // 这里是**一颗液晶像素的边长**（采样间隔），不是颗粒本身的大小 —— 颗粒大小
  // 由它与下面的「颗粒间隔」共同决定。
  { key: 'pitch', labelKey: 'fx.lcd.pitch', type: 'range', min: 1, max: 12, step: 0.1, defaultValue: 2.4 },
  // 黑矩阵宽度，占一颗液晶像素边长的百分比。真实面板的像素之间有一条明显的
  // 黑缝，不是紧贴在一起的。0 = 贴死（不像屏幕），20% 左右接近常见面板。
  { key: 'gap', labelKey: 'fx.lcd.gap', type: 'range', min: 0, max: 50, step: 1, defaultValue: 20 },
  { key: 'glare', labelKey: 'fx.lcd.glare', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.35 },
  { key: 'broken', labelKey: 'fx.lcd.broken', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
];
