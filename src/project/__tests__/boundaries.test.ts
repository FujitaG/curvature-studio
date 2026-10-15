import { beforeEach, expect, it } from 'vitest';
import { useStudioStore as studio } from '../../state/store';
import { useProjectStore as project } from '../store';
import { parseDocJson, docToJson, MAX_IMPORT_BYTES } from '../../state/persistence';
import { parseProjectJson, serializeProject } from '../format';
import { applyProject, captureProject } from '../workspace';
import { stampTemplate } from '../../data/templateActions';
import { templates } from '../../data/templates';
import { MAX_ENTITY_ID, validEntityId } from '../../state/ids';
import { fitCamera2d, graphViewport, resizeCamera2d, validCamera2d } from '../../state/camera2d';
import example from '../../../examples/cube-study.curvature.json';

beforeEach(() => {
  studio.setState(studio.getInitialState()); project.setState(project.getInitialState());
  applyProject(parseProjectJson(example), false);
});
const highIds = () => parseDocJson({ format: 'curvature-studio/doc', version: 1,
  vertices: [{ id: MAX_ENTITY_ID, x: 0, y: 0 }, { id: MAX_ENTITY_ID - 1, x: 64, y: 0 }],
  edges: [{ id: MAX_ENTITY_ID, a: MAX_ENTITY_ID, b: MAX_ENTITY_ID - 1, kind: 'bond' }]
});
const roundTrip = () => parseProjectJson(JSON.parse(serializeProject(captureProject())));

it('preserves large existing IDs while allocating three distinct, portable vertices', () => {
  applyProject(parseProjectJson({ format: 'curvature-studio/doc', version: 1, vertices: [{ id: MAX_ENTITY_ID, x: 0, y: 0 }], edges: [] }));
  const ids = [10, 20, 30].map(x => studio.getState().addVertex(x, x));
  expect(new Set(ids).size).toBe(3);
  expect(studio.getState().doc.vertices.size).toBe(4);
  expect(roundTrip().session.doc.vertices.get(MAX_ENTITY_ID)).toMatchObject({ x: 0, y: 0 });
  expect(ids.every(validEntityId)).toBe(true);
  studio.getState().undo(); studio.getState().redo();
  expect(roundTrip().session.doc.vertices.size).toBe(4);
});

it('wraps batch allocation, preserves references, and supports draw/template/Undo after high-ID imports', () => {
  studio.getState().replaceDoc(highIds(), false, true);
  // Exercise a counter that would overflow in the middle of allocating two vertices.
  studio.setState({ nextVertexIdCounter: MAX_ENTITY_ID - 2, nextEdgeIdCounter: MAX_ENTITY_ID });
  studio.getState().createEdgeBetweenNewVertices(0, 80, 64, 80, 'bond');
  const first = studio.getState().createVertexAndEdge(MAX_ENTITY_ID, 100, 100, 'brace')!;
  const second = studio.getState().addVertex(200, 100);
  studio.getState().createOrConvertEdge(first, second, 'bond');
  expect(studio.getState().doc.vertices.size).toBe(6);
  expect(studio.getState().doc.edges.size).toBe(4);
  const before = docToJson(studio.getState().doc);
  expect(stampTemplate(templates.find(value => value.id === 'cube')!)).toBe(true);
  const saved = roundTrip().session.doc;
  expect(saved.vertices.size).toBe(14); expect(saved.edges.size).toBe(16);
  expect(saved.edges.get(MAX_ENTITY_ID)).toEqual(highIds().edges.get(MAX_ENTITY_ID));
  studio.getState().undo(); expect(docToJson(roundTrip().session.doc)).toEqual(before);
  studio.getState().redo(); expect(roundTrip().session.doc.vertices.size).toBe(14);
});

it.each([-1000000, 1000000])('round-trips Fit, zoom, locate-style translations and resize at coordinate %s', x => {
  const doc = parseDocJson({ format: 'curvature-studio/doc', version: 1, vertices: [{ id: 1, x, y: -x }], edges: [] });
  applyProject(parseProjectJson(docToJson(doc)));
  const wide = graphViewport(1280, 900), narrow = graphViewport(320, 844);
  const fitted = fitCamera2d(doc, wide);
  expect(Math.abs(fitted.tx)).toBeGreaterThan(1000000);
  for (const camera of [fitted, { tx: 160 - x * 10000, ty: 450 + x * 10000, scale: 10000 }, resizeCamera2d(fitted, wide, narrow)]) {
    studio.getState().setCamera2d(camera);
    expect(roundTrip().session.camera2d).toEqual(camera);
    expect(roundTrip().session.cameraWarnings).toBeUndefined();
  }
});

it('fits both coordinate extremes into a narrow viewport with a portable scale', () => {
  const doc = highIds(); doc.vertices.forEach((vertex, i) => { vertex.x = i === MAX_ENTITY_ID ? -1e6 : 1e6; });
  const camera = fitCamera2d(doc, graphViewport(320, 844));
  expect(validCamera2d(camera)).toBe(true);
  studio.getState().replaceDoc(doc); studio.getState().setCamera2d(camera);
  expect(roundTrip().session.camera2d).toEqual(camera);
});

it('rejects coordinate-overflow edits atomically and can place a template beside a boundary vertex', () => {
  applyProject(parseProjectJson({ format: 'curvature-studio/doc', version: 1, vertices: [{ id: 1, x: 1e6, y: 0, p3: [1e6, 0, 0] }], edges: [] }));
  const before = studio.getState().doc, history = studio.getState().historyPast;
  expect(studio.getState().addVertex(1e6 + 1, 0)).toBe(-1);
  expect(studio.getState().createEdgeBetweenNewVertices(0, 0, 1e6 + 1, 0, 'bond')).toBeNull();
  expect(studio.getState().createVertexAndEdge(1, 0, -1e6 - 1, 'bond')).toBeNull();
  studio.getState().moveVertices([1], 1, 0);
  studio.getState().moveVertices3d([{ id: 1, p3: [1e6 + 1, 0, 0] }]);
  expect(studio.getState().doc).toBe(before); expect(studio.getState().historyPast).toBe(history);
  expect(stampTemplate(templates.find(value => value.id === 'cube')!)).toBe(true);
  expect(roundTrip().session.doc.vertices.size).toBe(9);
});

it('recovers invalid cameras while retaining graph, metadata and extensions; saved state is strict', () => {
  const input = captureProject();
  input.session.camera2d.tx = 1e300;
  input.session.camera3d = { position: [0, 0, 0], target: [0, 0, 0], projection: 'perspective' };
  const parsed = parseProjectJson(input);
  expect(parsed.session.cameraWarnings).toHaveLength(2);
  expect(parsed.session.doc.vertices.size).toBe(8);
  expect(parsed.metadata).toEqual(input.metadata); expect(parsed.extensions).toEqual(input.extensions);
  applyProject(parsed);
  expect(roundTrip().session.cameraWarnings).toBeUndefined();
  expect(serializeProject(captureProject())).not.toContain('cameraWarnings');
  expect(studio.getState().toasts.some(toast => toast.message.includes('graph is intact'))).toBe(true);
  expect(() => serializeProject(input)).toThrow(/camera/);
});

it('saves a million short extension values compactly and reopens them without dropping data', () => {
  const input = { ...example, extensions: { 'org.example.values': Array(1000000).fill(0) } };
  expect(new Blob([JSON.stringify(input)]).size).toBeLessThan(MAX_IMPORT_BYTES);
  applyProject(parseProjectJson(input));
  const snapshot = captureProject();
  expect(new Blob([JSON.stringify(snapshot, null, 2)]).size).toBeGreaterThan(MAX_IMPORT_BYTES);
  const text = serializeProject(snapshot);
  expect(new Blob([text]).size).toBeLessThan(MAX_IMPORT_BYTES);
  expect(parseProjectJson(JSON.parse(text)).extensions).toEqual(input.extensions);
});

it('checks final UTF-8 byte size at, below and above the limit without discarding extensions', () => {
  const snapshot = captureProject(); snapshot.extensions = { payload: '' };
  const base = new Blob([serializeProject(snapshot)]).size;
  snapshot.extensions.payload = 'x'.repeat(MAX_IMPORT_BYTES - base - 3) + 'あ';
  expect(new Blob([serializeProject(snapshot)]).size).toBe(MAX_IMPORT_BYTES);
  snapshot.extensions.payload += 'x';
  expect(() => serializeProject(snapshot)).toThrow(/8 MiB/);
  expect((snapshot.extensions.payload as string).endsWith('あx')).toBe(true);
  snapshot.extensions.payload = 'あ';
  expect(parseProjectJson(JSON.parse(serializeProject(snapshot))).extensions.payload).toBe('あ');
});


it('round-trips panel visibility while keeping older project defaults and Undo open', () => {
  applyProject(parseProjectJson(example));
  expect(studio.getState().panels).toEqual({ histogram: true, inspector: true, hints: true, legend: true });
  studio.getState().setPanelVisible('histogram', false);
  studio.getState().setPanelVisible('inspector', false);
  studio.getState().setPanelVisible('hints', false);
  const snapshot = captureProject();
  expect(roundTrip().session.panels).toEqual(studio.getState().panels);
  applyProject(parseProjectJson(example));
  expect(studio.getState().panels.histogram).toBe(true);
  expect(project.getState().previousProject!.session.panels).toEqual(snapshot.session.panels);
  applyProject(parseProjectJson(snapshot));
  expect(studio.getState().panels.histogram).toBe(false);
  expect(() => parseProjectJson({ ...snapshot, session: { ...snapshot.session, panels: { histogram: 'false' } } })).toThrow(/visibility/);
});
