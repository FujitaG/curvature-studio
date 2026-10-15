import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STUDIO_STYLE } from '../../state/style';
import { docFromArrays, docToJson, MAX_IMPORT_BYTES, parseDocJson, readJsonFile } from '../../state/persistence';
import { parseSessionJson, sessionToJson } from '../../state/interchange';
import { useStudioStore } from '../../state/store';
import { CALCULATION, newMetadata, parseProjectJson, projectFilename, projectToJson } from '../format';
import { applyProject, captureProject, restorePreviousProject } from '../workspace';
import { useProjectStore } from '../store';
import { getSavedCamera3d, setSavedCamera3d } from '../../state/viewMemory';
import example from '../../../examples/cube-study.curvature.json';

const graph = () => docFromArrays([{ id: 1, x: 0, y: 0, p3: [0, 0, 1], baked3d: true }, { id: 2, x: 64, y: 0, baked3d: false }], [{ id: 7, a: 1, b: 2, kind: 'bond' }]);
function fixture() {
  return { format: 'curvature-studio/project', version: 1,
    metadata: newMetadata('研究グラフ'), calculation: CALCULATION,
    session: sessionToJson({ doc: graph(), view: '2d', metric: 'keff', camera2d: { tx: 350, ty: 300, scale: 2 }, labelsVisible: false, histogramCollapsed: true, style: DEFAULT_STUDIO_STYLE, customGradients: [], camera3d: { position: [1, 2, 6], target: [0, 0, 0], projection: 'orthographic', orthographic: { left: -2, right: 2, top: 3, bottom: -3, zoom: 2 } } }),
    resultsDisplay: { precision: 8 }, extensions: { 'org.example.annotations': { labels: ['日本語', 'edge 7'], revision: 3 } }
  };
}

afterEach(() => vi.restoreAllMocks());
describe('portable project contract', () => {
  it('opens and rewrites the published cube example without data loss', () => {
    const parsed = parseProjectJson(example);
    expect(parsed.session.doc.edges.size).toBe(12);
    expect(projectToJson(parsed)).toEqual(example);
  });
  it('round-trips Unicode, notes, separate styles, camera, precision, extensions, and 3D pins', () => {
    const input = fixture(); input.metadata.notes = 'A reproducible comparison\nWith a second line';
    input.session.style = structuredClone(DEFAULT_STUDIO_STYLE);
    input.session.style.view2d = { ...input.session.style.view2d, bondWidth: 3 };
    const parsed = parseProjectJson(JSON.parse(JSON.stringify(input)));
    expect(projectToJson(parsed)).toEqual(input);
    expect(parsed.session.doc.vertices.get(1)?.baked3d).toBe(true);
    expect(parsed.session.style.view3d.bondWidth).toBe(2);
    input.extensions['org.example.annotations'].labels.push('mutated');
    expect(parsed.extensions).not.toEqual(input.extensions);
  });
  it('migrates legacy document and v1/v2 sessions', () => {
    expect(parseProjectJson(docToJson(graph()), 'Old graph').metadata.title).toBe('Old graph');
    const session = fixture().session;
    expect(parseProjectJson(session).session.metric).toBe('keff');
    expect(parseProjectJson({ ...session, version: 1, style: { ...DEFAULT_STUDIO_STYLE.view2d, metricGradients: DEFAULT_STUDIO_STYLE.shared.metricGradients } }).session.style).toEqual(DEFAULT_STUDIO_STYLE);
  });
  it.each([null, [], { ...fixture(), version: 2 }, { ...fixture(), version: '1' }, { ...fixture(), calculation: { ...CALCULATION, laziness: 0.25 } }, { ...fixture(), resultsDisplay: { precision: 11 } }])('rejects unsupported or malformed project input', (input) => {
    expect(() => parseProjectJson(input)).toThrow();
  });
  it('rejects excessive metadata and nested extensions', () => {
    expect(() => parseProjectJson({ ...fixture(), metadata: { ...newMetadata(), notes: 'x'.repeat(10001) } })).toThrow(/metadata/);
    let nested: unknown = 1; for (let i = 0; i < 32; i++) nested = { nested };
    expect(() => parseProjectJson({ ...fixture(), extensions: nested })).toThrow(/deeply/);
  });
  it('rejects null rows, duplicate endpoints, unsafe IDs, and invalid pins', () => {
    const doc = docToJson(graph());
    for (const vertices of [[null], [{ id: Number.MAX_SAFE_INTEGER, x: 0, y: 0 }], [{ id: 1, x: 0, y: 0, baked3d: 'yes' }]]) {
      expect(() => parseDocJson({ ...doc, vertices })).toThrow(/vertex|pin/i);
    }
    expect(() => parseDocJson({ ...doc, edges: [doc.edges[0], { ...doc.edges[0], id: 8, a: 2, b: 1 }] })).toThrow(/Duplicate edge endpoints/);
  });
  it('rejects string versions and validates cameras strictly before saving', () => {
    const session = fixture().session;
    expect(() => parseSessionJson({ ...session, version: '2' })).toThrow(/version/);
    expect(() => parseSessionJson({ ...session, camera2d: { tx: 1e300, ty: 0, scale: 1 } }, false)).toThrow(/camera/);
    expect(() => parseDocJson({ ...docToJson(graph()), vertices: [{ id: 1, x: 1e300, y: 0 }] })).toThrow(/vertex/);
    expect(() => parseSessionJson({ ...session, camera3d: { ...session.camera3d, position: [0, 0, 0] } }, false)).toThrow(/target/);
    expect(() => parseSessionJson({ ...session, camera3d: { ...session.camera3d, orthographic: { left: 2, right: -2, top: 3, bottom: -3, zoom: 1 } } }, false)).toThrow(/bounds/);
  });
  it('checks byte limits before reading and accepts UTF-8 BOM', async () => {
    const text = vi.fn();
    await expect(readJsonFile({ size: MAX_IMPORT_BYTES + 1, text } as unknown as File)).rejects.toThrow(/8 MiB/);
    expect(text).not.toHaveBeenCalled();
    await expect(readJsonFile({ size: 20, text: async () => '\uFEFF{"ok":true}' } as File)).resolves.toEqual({ ok: true });
  });
  it('uses safe filenames without stripping non-Latin project names', () => {
    expect(projectFilename('日本語/比較:01', '.curvature.json')).toBe('日本語-比較-01.curvature.json');
    expect(projectFilename('... ', '.curvature.json')).toBe('curvature-project.curvature.json');
  });
});

describe('workspace application', () => {
  beforeEach(() => { applyProject(parseProjectJson(fixture()), false); });
  it('restores the entire previous project after opening, without merging gradient libraries', () => {
    const before = captureProject();
    const next = fixture(); next.metadata.title = 'Replacement'; next.session.metric = 'ollivier';
    next.session.camera2d.tx = 900; next.resultsDisplay.precision = 2;
    applyProject(parseProjectJson(next));
    expect(useProjectStore.getState().metadata.title).toBe('Replacement');
    restorePreviousProject();
    expect(captureProject()).toEqual(before);
    expect(useProjectStore.getState().previousProject).toBeNull();
  });
  it('invalid input leaves both stores and camera intact', () => {
    const before = captureProject();
    expect(() => applyProject(parseProjectJson({ ...fixture(), session: { ...fixture().session, metric: 'future' } }))).toThrow();
    expect(captureProject()).toEqual(before);
  });
  it('applies graph and display settings when storage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const next = fixture(); next.metadata.title = 'Still usable';
    expect(() => applyProject(parseProjectJson(next))).not.toThrow();
    expect(useProjectStore.getState().metadata.title).toBe('Still usable');
    expect(useStudioStore.getState().doc.edges.size).toBe(1);
    expect(getSavedCamera3d()?.position).toEqual([1, 2, 6]);
  });
  it('adapts a saved camera center to a different viewport', () => {
    const input = fixture();
    applyProject(parseProjectJson({ ...input, session: { ...input.session, viewport: { width: window.innerWidth - 200, height: window.innerHeight - 100 } } }));
    expect(useStudioStore.getState().camera2d).toEqual({ tx: 450, ty: 350, scale: 2 });
    setSavedCamera3d(null);
  });
});
