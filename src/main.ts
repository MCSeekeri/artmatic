import { mount } from 'svelte';
import App from './ui/App.svelte';
import './app.css';
import { Renderer } from './engine/renderer';
import { SourceManager } from './engine/sources';
import { defaultProject, newId, type Project, type SourceClip } from './core/schema';

const app = mount(App, { target: document.getElementById('app')! });

/* B2 最小渲染验证：两层 solid 合成一帧。后续批次会换成完整应用装配。 */
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const host = document.getElementById('preview-host')!;
const renderer = new Renderer(canvas, () => null, () => {});
const sources = new SourceManager(renderer.kit);
renderer.setResolver(sources.resolve);
renderer.attachDisplay(host);

function solid(id: string, color: string, blend: SourceClip['blend'], opacity: number): SourceClip {
  return {
    kind: 'source',
    id,
    start: 0,
    end: 4,
    label: color,
    fadeSec: 0,
    curves: {},
    source: { type: 'solid', color },
    blend,
    opacity,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'stretch',
  };
}

const project: Project = defaultProject('b2-smoke');
project.duration = 4;
project.tracks = [
  { kind: 'visual', id: newId(), name: 'V1', enabled: true, clips: [solid('a', '#123a6e', 'normal', 1)] },
  { kind: 'visual', id: newId(), name: 'V2', enabled: true, clips: [solid('b', '#ff3b30', 'add', 0.6)] },
];

renderer.renderFrame(project, 0.5);

// 调试 / E2E 钩子：同一工程同一 t 反复 renderFrame 必须逐像素一致。
(window as unknown as Record<string, unknown>).__artmatic = {
  renderer,
  project,
  renderFrame: (t: number) => renderer.renderFrame(project, t),
  readPixels: () => {
    const { data, w, h } = renderer.readPixels();
    return { data: Array.from(data), w, h };
  },
};

export default app;
