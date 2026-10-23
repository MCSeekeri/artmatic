import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../../src/core/demo-project';
import { ProjectStore } from '../../src/core/project-store';
import { createTypographyDocument } from '../../src/typography/document';
import { docView } from '../../src/typography/agent-ops';
import { requireDoc, replaceDoc, setScripts } from '../../src/agent/typography';
import { ControlFailure } from '../../src/agent/types';

const CLIP = 'txt-scripts';

function fixture(): ProjectStore {
  const project = createBlankProject('script-test');
  const store = new ProjectStore(project);
  const track = project.tracks.find((t) => t.kind === 'visual')!;
  const doc = createTypographyDocument({ w: 640, h: 360 });
  store.addClip(track.id, {
    kind: 'source',
    id: CLIP,
    start: 0,
    end: 2,
    label: 'text',
    fadeSec: 0,
    curves: {},
    source: { type: 'text', doc },
    blend: 'normal',
    opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
    fit: 'contain',
  } as never);
  return store;
}

function failure(fn: () => unknown): ControlFailure {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ControlFailure);
    return err as ControlFailure;
  }
  throw new Error('expected a ControlFailure');
}

describe('typo_set_scripts（控制平面）', () => {
  it('写入后能读回；docView 的 scripts 可原样写回', () => {
    const store = fixture();
    const input = [
      {
        id: 's1',
        name: 'Reveal',
        code: "const el = ctx.el('a'); if (el) el.opacity(ctx.t);",
        enabled: true,
        needs: ['chars'],
        targets: ['a'],
      },
    ];
    const out = setScripts(store, CLIP, input);
    expect(out.scripts).toEqual(input);

    const doc = requireDoc(store, CLIP);
    const view = docView(doc, CLIP, 'full');
    expect(view.scripts).toEqual(input);
    // 读回的形状（不含 clipId）能直接再写一次
    setScripts(store, CLIP, view.scripts);
    expect(requireDoc(store, CLIP).scripts).toEqual(input);
  });

  it('[] 清空脚本（键一起删掉，不留一个空数组）', () => {
    const store = fixture();
    setScripts(store, CLIP, [{ id: 's1', name: 'S', code: 'ctx.t;', enabled: true }]);
    setScripts(store, CLIP, []);
    expect(requireDoc(store, CLIP).scripts).toBeUndefined();
  });

  it('语法错误在改动之前被拒，原脚本不受影响', () => {
    const store = fixture();
    setScripts(store, CLIP, [{ id: 's1', name: 'Good', code: 'ctx.t;', enabled: true }]);
    const err = failure(() =>
      setScripts(store, CLIP, [{ id: 's2', name: 'Bad', code: 'if (', enabled: true }]),
    );
    expect(err.code).toBe('invalid-argument');
    expect(requireDoc(store, CLIP).scripts!.map((s) => s.id)).toEqual(['s1']);
  });

  it('非法结构（重复 id / 超量 / 未知 needs）拒绝而不是静默丢弃', () => {
    const store = fixture();
    expect(failure(() => setScripts(store, CLIP, 'nope')).code).toBe('invalid-argument');
    expect(
      failure(() =>
        setScripts(store, CLIP, [
          { id: 'dup', code: '1;' },
          { id: 'dup', code: '2;' },
        ]),
      ).code,
    ).toBe('invalid-argument');
    expect(requireDoc(store, CLIP).scripts).toBeUndefined();
  });
});

describe('typo_replace_doc 与脚本', () => {
  it('省略 scripts 时保留原脚本；给 [] 才是显式清空', () => {
    const store = fixture();
    setScripts(store, CLIP, [{ id: 's1', name: 'S', code: 'ctx.t;', enabled: true }]);

    const doc = requireDoc(store, CLIP);
    const view = docView(doc, CLIP, 'full') as Record<string, unknown>;
    delete view.scripts;
    replaceDoc(store, CLIP, view);
    expect(requireDoc(store, CLIP).scripts).toHaveLength(1);

    replaceDoc(store, CLIP, { ...docView(requireDoc(store, CLIP), CLIP, 'full'), scripts: [] });
    expect(requireDoc(store, CLIP).scripts).toBeUndefined();
  });

  it('坏脚本条目被 sanitize 拒绝并报出来（不写半截）', () => {
    const store = fixture();
    const view = docView(requireDoc(store, CLIP), CLIP, 'full') as Record<string, unknown>;
    const out = replaceDoc(store, CLIP, {
      ...view,
      scripts: [{ id: 'bad', code: '' }],
    });
    expect(out.droppedKeys.some((k) => k.startsWith('scripts'))).toBe(true);
    expect(requireDoc(store, CLIP).scripts).toBeUndefined();
  });
});
