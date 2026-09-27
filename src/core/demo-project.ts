/**
 * demo-project.ts — 开箱 demo 工程。
 *
 * 16 秒 @120BPM（8 小节）：一条音频轨放程序生成的演示节拍，
 * 视觉轨在 B9 打磨成「底图 + 局部故障 + 全屏调色」三层。
 * 音频本体由 audio/demo-audio.ts 程序生成（无外部文件依赖）。
 */

import { defaultProject, newId, type Project } from './schema';

export const DEMO_ASSET_ID = 'demo-song';
export const DEMO_DURATION = 16;

export function createDemoProject(): Project {
  const p = defaultProject('Artmatic Demo');
  p.duration = DEMO_DURATION;
  p.beatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };
  p.assets[DEMO_ASSET_ID] = {
    id: DEMO_ASSET_ID,
    kind: 'audio',
    name: '演示节拍 120 BPM',
    durationSec: DEMO_DURATION,
  };
  p.tracks = [
    {
      kind: 'audio',
      id: newId(),
      name: 'A1 音乐',
      enabled: true,
      bus: 'master',
      clips: [
        {
          kind: 'audio',
          id: newId(),
          start: 0,
          end: DEMO_DURATION,
          label: '演示节拍',
          fadeSec: 0,
          curves: {},
          assetId: DEMO_ASSET_ID,
          srcIn: 0,
        },
      ],
    },
    {
      kind: 'visual',
      id: newId(),
      name: 'V1 底图',
      enabled: true,
      clips: [
        {
          kind: 'source',
          id: newId(),
          start: 0,
          end: DEMO_DURATION,
          label: '底色',
          fadeSec: 0,
          curves: {},
          source: { type: 'solid', color: '#10203c' },
          blend: 'normal',
          opacity: 1,
          transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
          fit: 'stretch',
        },
      ],
    },
  ];
  return p;
}
