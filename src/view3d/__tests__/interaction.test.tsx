import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { View3D } from '../View3D';
import { instancesFor } from '../batches';
import { createStudioStore, getActiveStudioStore, useStudioStore as studio } from '../../state/store';
import { exportScene, sceneApis } from '../sceneApis';
import { getSavedCamera3d, setSavedCamera3d } from '../../state/viewMemory';
import { docFromArrays } from '../../state/persistence';
import { computeMetrics } from '../../math';

// Only the GPU boundary is replaced. Scene geometry, picking, controls, React and
// store actions are real, so this also runs in containers without a WebGL driver.
const renderers = vi.hoisted(() => [] as Array<{
  domElement: HTMLCanvasElement; frames: number; scene: THREE.Scene; camera: THREE.Camera;
  getPixelRatio: () => number; contextLost: boolean; disposed: boolean;
}>);
vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement('canvas');
    frames = 0; ratio = 1; width = 800; height = 600;
    scene!: THREE.Scene; camera!: THREE.Camera;
    contextLost = false; disposed = false;
    constructor() { renderers.push(this); }
    getContext() { return { isContextLost: () => this.contextLost }; }
    getPixelRatio() { return this.ratio; }
    setPixelRatio(value: number) { this.ratio = value; }
    setDrawingBufferSize(width: number, height: number, ratio: number) { this.ratio = ratio; this.setSize(width, height, false); }
    getSize(target: THREE.Vector2) { return target.set(this.width, this.height); }
    setSize(width: number, height: number, updateStyle = true) {
      this.width = width; this.height = height;
      this.domElement.width = Math.floor(width * this.ratio);
      this.domElement.height = Math.floor(height * this.ratio);
      if (updateStyle) { this.domElement.style.width = `${width}px`; this.domElement.style.height = `${height}px`; }
    }
    render(scene: THREE.Scene, camera: THREE.Camera) {
      this.frames++; this.scene = scene; this.camera = camera;
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
    }
    dispose() { this.disposed = true; }
  } };
});

let root: Root, container: HTMLDivElement;
let pending: Map<number, FrameRequestCallback>, nextId: number, time: number;
let width: number, height: number;
let resize: ResizeObserverCallback;
const renderer = () => renderers.at(-1)!;
const groups = () => renderer().scene.children.filter((v): v is THREE.Group => v instanceof THREE.Group);
const vertexMesh = (id: number) => groups()[0].children.flatMap(v => [...instancesFor(v)]).find(v => v.userData?.kind === 'vertex' && v.userData.id === id)!;
const edgeMeshes = () => groups()[0].children.flatMap(v => [...instancesFor(v)]).filter(v => v.userData?.kind === 'edge');
const diagnostics = () => (window as unknown as { __curvatureStudioRenderStats: () => {
  raycasts: number; rebuilds: number; appearanceUpdates: number; preview: boolean; quality: number;
  labels: { visited: number; projections: number }; simplifiedMeshes: number;
} }).__curvatureStudioRenderStats();
const frame = async (interval = 16) => {
  await act(async () => {
    time += interval;
    const callbacks = [...pending.values()]; pending.clear();
    callbacks.forEach(fn => fn(time));
  });
};
const flush = async (max = 150) => {
  for (let i = 0; pending.size && i < max; i++) {
    await frame();
  }
  expect(pending.size, 'Rendering never became idle').toBe(0);
};
const screenPoint = (point: THREE.Vector3) => {
  const p = point.clone().project(renderer().camera);
  return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
};
const pointer = (type: string, x: number, y: number) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  renderer().domElement.dispatchEvent(event);
};
const cubeScene = async (count: number) => {
  const { templates } = await import('../../data/templates');
  const cube = templates.find(value => value.id === 'cube')!;
  const vertices = Array.from({ length: count }, (_, cell) => cube.vertices3d.map((p, i) => ({ id: cell * 8 + i + 1, x: p[0] * 64, y: p[1] * 64, p3: [p[0] + cell % 5 * 3, p[1] + Math.floor(cell / 5) * 3, p[2]] as [number, number, number] }))).flat();
  const edges = Array.from({ length: count }, (_, cell) => cube.edges.map(([a, b], i) => ({ id: cell * 12 + i + 1, a: cell * 8 + a + 1, b: cell * 8 + b + 1, kind: 'bond' as const }))).flat();
  return { doc: docFromArrays(vertices, edges), vertices, edges };
};

beforeEach(async () => {
  renderers.length = 0; pending = new Map(); nextId = 0; time = 0; width = 800; height = 600;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { pending.set(++nextId, fn); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} }));
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value() {} });
  Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', { configurable: true, value() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ measureText: (s: string) => ({ width: s.length * 30 }), strokeText() {}, fillText() {} }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(3);
  setSavedCamera3d(null);
  const doc = docFromArrays([{ id: 1, x: -64, y: 0, p3: [-1, 0, 0] }, { id: 2, x: 64, y: 0, p3: [1, 0, 0] }, { id: 3, x: 0, y: -64, p3: [0, 1, 0] }],
    [{ id: 1, a: 1, b: 2, kind: 'bond' }, { id: 2, a: 2, b: 3, kind: 'bond' }, { id: 3, a: 3, b: 1, kind: 'bond' }]);
  studio.setState({ ...studio.getInitialState(), doc, results: computeMetrics([...doc.vertices.values()], [...doc.edges.values()]), view: '3d', tool: 'select' });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<View3D />));
  await flush();
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(pending.size).toBe(0);
  container.remove();
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).setPointerCapture;
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).releasePointerCapture;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('renders changes and projection switches, then returns to idle', async () => {
  const initialFrames = renderer().frames;
  await flush();
  expect(renderer().frames).toBe(initialFrames);
  expect(renderer().getPixelRatio()).toBe(2);
  const sprites = groups()[0].children.filter((v): v is THREE.Sprite => v instanceof THREE.Sprite);
  expect(sprites.length).toBeGreaterThan(0);
  expect(sprites.every((v) => v.material.map!.image.height === 72)).toBe(true);
  await act(async () => studio.getState().toggleLabels()); await flush();
  expect(renderer().frames).toBeGreaterThan(initialFrames);
  expect(groups()[0].children.some((v) => v instanceof THREE.Sprite)).toBe(false);
  await act(async () => studio.getState().setProjection('orthographic')); await flush();
  expect(renderer().camera).toBeInstanceOf(THREE.OrthographicCamera);
  expect(getSavedCamera3d()!.projection).toBe('orthographic');
  await act(async () => window.dispatchEvent(new Event('curvature-studio:fit-3d'))); await flush();
  expect(pending.size).toBe(0);
  // Replacement controls must still request frames after a projection switch.
  const frames = renderer().frames;
  await act(async () => renderer().domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, cancelable: true })));
  await flush();
  expect(renderer().frames).toBeGreaterThan(frames);
});

it('keeps threshold colors and geometry live under selection outlines without changing the graph or results', async () => {
  const original = studio.getState();
  const selection = [...original.doc.edges.keys()].map(id => ({ kind: 'edge' as const, id }));
  await act(async () => studio.getState().setSelection(selection)); await flush();
  const meshes = edgeMeshes().map(instance => instance.mesh);
  const rebuilds = diagnostics().rebuilds;
  for (const [threshold, expected] of [[0, '#ff0000'], [1, '#0000ff'], [0, '#ff0000']] as const) {
    await act(async () => studio.getState().setMetricGradient('keff', {
      type: 'threshold', threshold, width: 0, lowColor: '#0000FF', highColor: '#FF0000',
    })); await flush();
    expect(edgeMeshes().map(instance => instance.mesh)).toEqual(meshes);
    for (const instance of edgeMeshes()) {
      const color = new THREE.Color();
      instance.mesh!.getColorAt(instance.index, color);
      expect(`#${color.getHexString()}`).toBe(expected);
    }
    for (const overlay of groups()[1].children as THREE.InstancedMesh[]) {
      expect((overlay.material as THREE.MeshBasicMaterial).side).toBe(THREE.BackSide);
      expect((overlay.material as THREE.MeshBasicMaterial).depthTest).toBe(true);
    }
    expect(studio.getState().selection).toEqual(selection);
    expect(studio.getState().doc).toBe(original.doc);
    expect(studio.getState().results).toBe(original.results);
    expect(diagnostics().rebuilds).toBe(rebuilds);
  }
});

it.each(['single', 'double', 'dashed'] as const)('moves %s edges using existing buffers and textures, commits the final pointer, and supports Undo', async (bondStyle) => {
  await act(async () => studio.getState().setStyle((style) => ({ ...style, view3d: { ...style.view3d, bondStyle, bondCasing: { ...style.view3d.bondCasing, enabled: true } } })));
  await flush();
  const original = studio.getState().doc;
  const start = screenPoint(vertexMesh(1).position);
  await act(async () => pointer('pointerdown', start.x, start.y));
  expect(studio.getState().selection).toEqual([{ kind: 'vertex', id: 1 }]);
  await flush();
  const meshes = edgeMeshes(), buffers = meshes.map((v) => v.mesh.geometry);
  const textures = groups()[0].children.filter((v): v is THREE.Sprite => v instanceof THREE.Sprite).map((v) => v.material.map);
  await act(async () => {
    for (let i = 1; i <= 30; i++) pointer('pointermove', start.x + i, start.y + i / 2);
  });
  expect(pending.size).toBe(1);
  await flush();
  expect(edgeMeshes()).toEqual(meshes);
  expect(edgeMeshes().map((v) => v.mesh.geometry)).toEqual(buffers);
  expect(groups()[0].children.filter((v): v is THREE.Sprite => v instanceof THREE.Sprite).map((v) => v.material.map)).toEqual(textures);
  expect(studio.getState().doc).toBe(original);
  const preview = vertexMesh(1).position.clone();
  await act(async () => pointer('pointerup', start.x + 50, start.y + 20)); await flush();
  expect(vertexMesh(1).position.distanceTo(preview)).toBeGreaterThan(0.01);
  expect(studio.getState().historyPast).toHaveLength(1);
  await act(async () => studio.getState().undo()); await flush();
  expect(studio.getState().doc).toEqual(original);
});

it('shows and clears hover and connection previews after the renderer has become idle', async () => {
  const a = screenPoint(vertexMesh(1).position), b = screenPoint(vertexMesh(2).position);
  await act(async () => pointer('pointermove', a.x, a.y)); await flush();
  expect(groups()[3].children.length).toBeGreaterThan(0);
  await act(async () => pointer('pointerleave', a.x, a.y)); await flush();
  expect(groups()[3].children.length).toBe(0);
  await act(async () => studio.getState().setTool('brace'));
  await act(async () => { pointer('pointerdown', a.x, a.y); pointer('pointermove', b.x, b.y); }); await flush();
  expect(groups()[4].children.length).toBeGreaterThan(0);
  await act(async () => pointer('pointerup', b.x, b.y)); await flush();
  expect(groups()[4].children.length).toBe(0);
  expect(studio.getState().doc.edges.get(1)!.kind).toBe('brace');
});

it('keeps an active vertex drag when background curvature results arrive', async () => {
  const start = screenPoint(vertexMesh(1).position);
  await act(async () => pointer('pointerdown', start.x, start.y)); await flush();
  await act(async () => pointer('pointermove', start.x + 30, start.y + 10)); await flush();
  const preview = vertexMesh(1).position.clone();
  await act(async () => {
    const result = studio.getState().results!;
    studio.getState().setResults({ ...result, values: result.values.map(value => ({ ...value })) });
  });
  await flush();
  expect(vertexMesh(1).position.distanceTo(preview)).toBeLessThan(1e-9);
  await act(async () => pointer('pointerup', start.x + 50, start.y + 20)); await flush();
  expect(vertexMesh(1).position.distanceTo(preview)).toBeGreaterThan(0.01);
  expect(studio.getState().historyPast).toHaveLength(1);
});

it('restores the displayed vertex when a drag would exceed the portable coordinate limit', async () => {
  const original = studio.getState().doc;
  const translated = docFromArrays([...original.vertices.values()].map(v => ({ ...v, p3: [1e6 - 1 + v.p3![0], v.p3![1], v.p3![2]] as [number, number, number] })), [...original.edges.values()]);
  await act(async () => studio.getState().replaceDoc(translated)); await flush();
  await act(async () => window.dispatchEvent(new Event('curvature-studio:fit-3d'))); await flush();
  const before = studio.getState().doc, point = vertexMesh(2).position.clone(), start = screenPoint(point);
  await act(async () => pointer('pointerdown', start.x, start.y)); await flush();
  await act(async () => pointer('pointermove', start.x + 200, start.y)); await flush();
  expect(vertexMesh(2).position.x).toBeGreaterThan(1e6);
  await act(async () => pointer('pointerup', start.x + 200, start.y)); await flush();
  expect(studio.getState().doc).toBe(before);
  expect(vertexMesh(2).position.distanceTo(point)).toBeLessThan(1e-9);
});

it('batches a dense scene and creates textures only for labels actually shown', async () => {
  const { doc, vertices, edges } = await cubeScene(125);
  await act(async () => { studio.getState().replaceDoc(doc); studio.getState().setResults(computeMetrics(vertices, edges)); });
  await flush();
  const content = groups()[0];
  expect(content.children.every(value => value instanceof THREE.InstancedMesh)).toBe(true);
  expect(content.children.length).toBeLessThanOrEqual(3);
  expect(content.children.flatMap(value => [...instancesFor(value)]).filter(value => value.userData?.kind === 'edge')).toHaveLength(1500);
  expect(diagnostics().labels).toMatchObject({ visited: 0, projections: 0 });
  await act(async () => studio.getState().setSelection([{ kind: 'edge', id: 1 }])); await flush();
  expect(content.children.filter(value => value instanceof THREE.Sprite)).toHaveLength(1);
  expect(diagnostics().labels).toMatchObject({ visited: 1, projections: 2 });
});

it('skips hover picking throughout rotation, adapts slow frames, and restores quality and hover at rest', async () => {
  await act(async () => studio.getState().setSelection([{ kind: 'edge', id: 1 }])); await flush();
  const originalCamera = getSavedCamera3d();
  const content = groups()[0].children.filter((v): v is THREE.InstancedMesh => v instanceof THREE.InstancedMesh);
  const fullGeometry = content.map(v => v.geometry);
  await act(async () => pointer('pointerdown', 30, 30));
  const raycasts = diagnostics().raycasts;
  for (let i = 1; i <= 12; i++) {
    await act(async () => pointer('pointermove', 30 + i * 5, 30 + i * 2));
    await frame(32);
  }
  expect(diagnostics()).toMatchObject({ preview: true, quality: 2, raycasts });
  expect(renderer().getPixelRatio()).toBe(1.25);
  expect(getSavedCamera3d()).not.toEqual(originalCamera);
  expect(studio.getState().selection).toEqual([{ kind: 'edge', id: 1 }]);
  const before = { width: renderer().domElement.width, height: renderer().domElement.height, ratio: renderer().getPixelRatio() };
  const previewGeometry = content.map(v => v.geometry);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    expect(this.width).toBe(width * 2); expect(this.height).toBe(height * 2);
    expect(content.map(v => v.geometry)).toEqual(fullGeometry);
    return 'data:image/png;base64,test';
  });
  (window as unknown as { __curvatureStudioCapture3d: () => string }).__curvatureStudioCapture3d();
  expect({ width: renderer().domElement.width, height: renderer().domElement.height, ratio: renderer().getPixelRatio() }).toEqual(before);
  expect(content.map(v => v.geometry)).toEqual(previewGeometry);
  await act(async () => pointer('pointerup', 90, 54)); await flush();
  expect(diagnostics()).toMatchObject({ preview: false, quality: 0, simplifiedMeshes: 0, raycasts: raycasts + 1 });
  expect(renderer().getPixelRatio()).toBe(2);
  expect(content.map(v => v.geometry)).toEqual(fullGeometry);
  const point = screenPoint(vertexMesh(1).position);
  await act(async () => pointer('pointermove', point.x, point.y)); await flush();
  expect(groups()[3].children.length).toBeGreaterThan(0);
});

it('updates colors, values and label appearance without replacing instance buffers', async () => {
  const content = groups()[0].children.filter((v): v is THREE.InstancedMesh => v instanceof THREE.InstancedMesh);
  const matrices = content.map(v => v.instanceMatrix), geometries = content.map(v => v.geometry);
  const before = diagnostics();
  const edge = edgeMeshes()[0];
  const originalColor = new THREE.Color(); edge.mesh.getColorAt(edge.index, originalColor);
  await act(async () => studio.getState().setMetric('ollivier')); await flush();
  const nextColor = new THREE.Color(); edge.mesh.getColorAt(edge.index, nextColor);
  expect(nextColor.equals(originalColor)).toBe(false);
  await act(async () => studio.getState().setStyle(style => ({ ...style,
    view3d: { ...style.view3d, vertexFill: { ...style.view3d.vertexFill, color: '#12AB34' }, labelScale: 1.5 }
  }))); await flush();
  expect((vertexMesh(1).mesh.material as THREE.MeshLambertMaterial).color.getHexString()).toBe('12ab34');
  await act(async () => {
    const result = studio.getState().results!;
    studio.getState().setResults({ ...result, values: result.values.map(value => ({ ...value })) });
  }); await flush();
  expect(groups()[0].children.filter(v => v instanceof THREE.InstancedMesh)).toEqual(content);
  expect(content.map(v => v.instanceMatrix)).toEqual(matrices);
  expect(content.map(v => v.geometry)).toEqual(geometries);
  expect(diagnostics().rebuilds).toBe(before.rebuilds);
  expect(diagnostics().appearanceUpdates).toBeGreaterThan(before.appearanceUpdates);
});

it('restores ordinary labels after medium-scene navigation and includes them in mid-gesture exports', async () => {
  const { doc, vertices, edges } = await cubeScene(20);
  await act(async () => {
    studio.getState().replaceDoc(doc);
    studio.getState().setResults(computeMetrics(vertices, edges));
    studio.getState().setSelection([{ kind: 'edge', id: 1 }]);
    window.dispatchEvent(new Event('curvature-studio:fit-3d'));
  }); await flush();
  expect(diagnostics().labels.visited).toBe(240);
  await act(async () => pointer('pointerdown', 20, 20)); await frame();
  expect(diagnostics()).toMatchObject({ preview: true, labels: { visited: 1 } });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
    expect(diagnostics().labels.visited).toBe(240);
    return 'data:image/png;base64,test';
  });
  (window as unknown as { __curvatureStudioCapture3d: () => string }).__curvatureStudioCapture3d();
  expect(diagnostics().labels.visited).toBe(1);
  await act(async () => pointer('pointerup', 20, 20)); await flush();
  expect(diagnostics()).toMatchObject({ preview: false, labels: { visited: 240 } });
});

it('redraws resize and visibility changes and restores the screen after a full-size export', async () => {
  width = 3840; height = 2160;
  await act(async () => resize([], {} as ResizeObserver)); await flush();
  expect(renderer().domElement.width * renderer().domElement.height).toBeLessThanOrEqual(4_000_000);
  const frames = renderer().frames;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => studio.getState().toggleLabels());
  expect(pending.size).toBe(0);
  expect(renderer().frames).toBe(frames);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await flush();
  const before = { width: renderer().domElement.width, height: renderer().domElement.height, ratio: renderer().getPixelRatio() };
  const capture = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    expect(this.width).toBe(width * 2); expect(this.height).toBe(height * 2);
    return 'data:image/png;base64,test';
  });
  const result = (window as unknown as { __curvatureStudioCapture3d: () => string }).__curvatureStudioCapture3d();
  expect(result).toBe('data:image/png;base64,test'); expect(capture).toHaveBeenCalledOnce();
  expect({ width: renderer().domElement.width, height: renderer().domElement.height, ratio: renderer().getPixelRatio() }).toEqual(before);
});

it.each(['perspective', 'orthographic'] as const)('frames actual scene meshes at 0.1–100× in a narrow %s view without fog', async projection => {
  width = 320; height = 844;
  const panel = document.createElement('div'); panel.className = 'histogram'; container.append(panel);
  const rect = { x: 30, y: 600, left: 30, top: 600, width: 274, height: 228, right: 304, bottom: 828, toJSON() {} };
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(panel, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList);
  for (const scale of [0.1, 1, 10, 100]) {
    const original = await cubeScene(1);
    const vertices = original.vertices.map(v => ({ ...v, p3: v.p3.map(n => n * scale) as [number, number, number] }));
    const doc = docFromArrays(vertices, original.edges);
    await act(async () => { studio.setState({ doc, projection, selection: [] }); });
    await act(async () => window.dispatchEvent(new Event('curvature-studio:fit-3d')));
    await flush();
    expect(renderer().scene.fog).toBeNull();
    for (const vertex of vertices) {
      const position = vertexMesh(vertex.id).position;
      expect(position.toArray()).toEqual(vertex.p3);
      const screen = screenPoint(position);
      expect(screen.x).toBeGreaterThan(16); expect(screen.x).toBeLessThan(304);
      expect(screen.y).toBeGreaterThan(16); expect(screen.y).toBeLessThan(590);
      expect(Math.abs(position.clone().project(renderer().camera).z)).toBeLessThan(1);
    }
    expect(studio.getState().doc).toBe(doc);
    await act(async () => window.dispatchEvent(new CustomEvent('curvature-studio:locate-3d', { detail: { edgeId: 1 } })));
    await flush();
    for (const id of [original.edges[0].a, original.edges[0].b]) {
      const screen = screenPoint(vertexMesh(id).position);
      expect(screen.x).toBeGreaterThan(16); expect(screen.x).toBeLessThan(304);
      expect(screen.y).toBeGreaterThan(16); expect(screen.y).toBeLessThan(590);
    }
  }
  panel.remove();
});

it('rebinds geometry, navigation, camera persistence and exports when the store changes', async () => {
  let previous = getActiveStudioStore();
  const oldStores = [previous];
  for (let i = 0; i < 3; i++) {
    const next = createStudioStore(), doc = previous.getState().doc;
    // Even identical document references must receive a new renderer owner.
    next.setState({ doc, results: previous.getState().results, view: '3d' });
    setSavedCamera3d(getSavedCamera3d(previous), next);
    const oldRenderer = renderer(), oldCamera = getSavedCamera3d(previous);
    await act(async () => root.render(<View3D store={next} />)); await flush();
    expect(oldRenderer.disposed).toBe(true);
    expect(oldRenderer.domElement.isConnected).toBe(false);
    expect(sceneApis.has(previous)).toBe(false);
    expect(sceneApis.size).toBe(1);
    expect(vertexMesh(1).position.toArray()).toEqual(doc.vertices.get(1)!.p3);
    const before = getSavedCamera3d(next);
    await act(async () => renderer().domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, cancelable: true })));
    await flush();
    expect(getSavedCamera3d(next)).not.toEqual(before);
    expect(getSavedCamera3d(previous)).toEqual(oldCamera);
    await act(async () => window.dispatchEvent(new CustomEvent('curvature-studio:locate-3d', { detail: { store: next, edgeId: 1 } })));
    await flush();
    expect(getSavedCamera3d(next)!.position).toEqual(renderer().camera.position.toArray());
    expect(exportScene(next, 'svg')).toContain('<svg');
    expect(() => exportScene(previous, 'svg')).toThrow(/not ready/);
    expect(oldStores.every(store => !sceneApis.has(store))).toBe(true);
    oldStores.push(next); previous = next;
  }
});

it('rejects unrendered or context-lost exports instead of reading a cleared canvas', async () => {
  const owner = getActiveStudioStore(), capture = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL');
  renderer().contextLost = true;
  expect(() => exportScene(owner, 'png')).toThrow(/not ready/);
  expect(() => exportScene(owner, 'svg')).toThrow(/not ready/);
  expect(capture).not.toHaveBeenCalled();
  renderer().contextLost = false;
  await act(async () => {
    studio.setState({ doc: docFromArrays([], []) });
    expect(() => exportScene(owner, 'png')).toThrow(/not ready/);
  });
  await flush();
});
