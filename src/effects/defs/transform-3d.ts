import type { ParamDef } from '../types';

export const id = 'transform-3d';
export const nameKey = 'fx.transform3d';
export const params: ParamDef[] = [
  { key: 'rotX', labelKey: 'fx.transform3d.rotX', type: 'range', min: -180, max: 180, step: 1, defaultValue: 0 },
  { key: 'rotY', labelKey: 'fx.transform3d.rotY', type: 'range', min: -180, max: 180, step: 1, defaultValue: 25 },
  { key: 'rotZ', labelKey: 'fx.transform3d.rotZ', type: 'range', min: -180, max: 180, step: 1, defaultValue: 0 },
  { key: 'perspective', labelKey: 'fx.transform3d.perspective', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  { key: 'zoom', labelKey: 'fx.transform3d.zoom', type: 'range', min: 0.2, max: 3, step: 0.01, defaultValue: 1 },
  { key: 'spin', labelKey: 'fx.transform3d.spin', type: 'range', min: 0, max: 180, step: 1, defaultValue: 0 },
  {
    key: 'axis',
    labelKey: 'fx.transform3d.axis',
    type: 'select',
    defaultValue: 'y',
    options: [
      { labelKey: 'fx.transform3d.axisX', value: 'x' },
      { labelKey: 'fx.transform3d.axisY', value: 'y' },
      { labelKey: 'fx.transform3d.axisZ', value: 'z' },
      { labelKey: 'fx.transform3d.axisTumble', value: 'tumble' },
    ],
    // 自转速度为 0 时「绕哪个轴」没有意义（openmosh 原本就有这条）。
    visibleWhen: (v) => Number(v.spin) > 0,
  },
  {
    key: 'edge',
    labelKey: 'fx.transform3d.edge',
    type: 'select',
    defaultValue: 'none',
    options: [
      { labelKey: 'fx.transform3d.edgeNone', value: 'none' },
      { labelKey: 'fx.transform3d.edgeClamp', value: 'clamp' },
      { labelKey: 'fx.transform3d.edgeTile', value: 'tile' },
      { labelKey: 'fx.transform3d.edgeMirror', value: 'mirror' },
    ],
  },
];
