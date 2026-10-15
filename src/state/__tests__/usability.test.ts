import { describe, expect, it } from 'vitest';
import { fitCamera2d, graphViewport, resizeCamera2d } from '../camera2d';
import { docFromArrays } from '../persistence';
import { templateParameter, positionTemplate, stampTemplate } from '../../data/templateActions';
import { instantiateTemplate, templates } from '../../data/templates';
import { useStudioStore } from '../store';
import { useProjectStore } from '../../project/store';
import { applyProject, captureProject, createNewProject, restorePreviousProject, undoWorkspace } from '../../project/workspace';
import { parseProjectJson } from '../../project/format';
import example from '../../../examples/cube-study.curvature.json';

describe('template input and placement', () => {
  it('accepts only complete, in-range integer drafts without truncation or clamping', () => {
    for (const draft of ['', ' ', '1', '2', '129', '-3', '3.5', '3e1', 'NaN', 'Infinity', 'oops']) expect(templateParameter(draft, 3, 128)).toBeNull();
    for (const n of [3, 12, 128]) expect(templateParameter(String(n), 3, 128)).toBe(n);
    expect(templateParameter(' 012 ', 3, 128)).toBe(12);
  });
  it('places a second graph in a disjoint box in both 2D and 3D without moving the original', () => {
    const doc = parseProjectJson(example).session.doc;
    const before = structuredClone(doc);
    const instance = instantiateTemplate(templates.find((v) => v.id === 'k4')!, 100, 100, { x: 0, y: 0 });
    positionTemplate(instance, doc);
    expect(Math.min(...instance.vertices.map((v) => v.x))).toBeGreaterThan(Math.max(...[...doc.vertices.values()].map((v) => v.x)) + 64);
    expect(Math.min(...instance.vertices.map((v) => v.p3![0]))).toBeGreaterThan(Math.max(...[...doc.vertices.values()].map((v) => v.p3![0])) + 1);
    expect(doc).toEqual(before);
  });
  it('replaces the canvas without changing project metadata and supports ordinary Undo', () => {
    applyProject(parseProjectJson(example), false);
    useProjectStore.getState().setNotes('Keep these notes');
    const before = captureProject();
    stampTemplate(templates.find((v) => v.id === 'k4')!, undefined, 'replace');
    expect(useStudioStore.getState().doc.vertices.size).toBe(4);
    expect(useProjectStore.getState().metadata).toEqual(before.metadata);
    useStudioStore.getState().undo();
    expect(captureProject().session.doc).toEqual(before.session.doc);
  });
  it('the comparison example contains exactly one contact and one rigid tie', () => {
    const example = instantiateTemplate(templates.find((v) => v.id === 'bond-brace-example')!, 1, 1, { x: 0, y: 0 });
    expect(example.vertices).toHaveLength(3);
    expect(example.edges.map((e) => e.kind)).toEqual(['bond', 'brace']);
  });
});

describe('viewport changes', () => {
  const doc = docFromArrays([{ id: 1, x: -600, y: -100 }, { id: 2, x: 600, y: -100 }, { id: 3, x: 600, y: 300 }], []);
  it.each([390, 320])('keeps all fitted vertices in the available area after resizing to %i px', (width) => {
    const wide = graphViewport(1440, 960), narrow = graphViewport(width, 844, 218);
    useStudioStore.setState({ doc, viewport2d: wide });
    useStudioStore.getState().fit2d();
    useStudioStore.getState().resizeViewport2d(narrow);
    const camera = useStudioStore.getState().camera2d;
    for (const vertex of doc.vertices.values()) {
      const x = vertex.x * camera.scale + camera.tx, y = vertex.y * camera.scale + camera.ty;
      expect(x).toBeGreaterThanOrEqual(narrow.x - 1e-8);
      expect(x).toBeLessThanOrEqual(narrow.x + narrow.width + 1e-8);
      expect(y).toBeGreaterThanOrEqual(narrow.y - 1e-8);
      expect(y).toBeLessThanOrEqual(narrow.y + narrow.height + 1e-8);
    }
  });
  it('retains the manually chosen zoom and world centre through a round-trip resize', () => {
    const wide = graphViewport(1440, 960), narrow = graphViewport(320, 844, 218);
    const manual = { tx: 230, ty: -65, scale: 1.75 };
    useStudioStore.setState({ doc, viewport2d: wide, camera2dMode: 'fit' });
    useStudioStore.getState().setCamera2d(manual);
    useStudioStore.getState().resizeViewport2d(narrow);
    expect(useStudioStore.getState().camera2d).toEqual(resizeCamera2d(manual, wide, narrow));
    expect(useStudioStore.getState().camera2d.scale).toBe(manual.scale);
    useStudioStore.getState().resizeViewport2d(wide);
    expect(useStudioStore.getState().camera2d).toEqual(manual);
    expect(useStudioStore.getState().camera2dMode).toBe('manual');
  });
  it('fits degenerate geometry without non-finite cameras', () => {
    const single = docFromArrays([{ id: 1, x: 100, y: 100 }], []);
    expect(Object.values(fitCamera2d(single, graphViewport(320, 844))).every(Number.isFinite)).toBe(true);
  });
});

describe('new project and clear canvas', () => {
  it('starts a fresh identity, clears notes and extensions, and restores the entire prior project', () => {
    applyProject(parseProjectJson(example), false);
    useProjectStore.getState().setNotes('Previous experiment');
    useProjectStore.setState({ extensions: { 'org.example': { annotation: 'retain' } }, precision: 8 });
    const before = captureProject();
    createNewProject();
    const fresh = captureProject();
    expect(fresh.metadata.id).not.toBe(before.metadata.id);
    expect(fresh.metadata.title).toBe('Untitled project');
    expect(fresh.metadata.notes).toBe('');
    expect(fresh.extensions).toEqual({});
    expect(fresh.resultsDisplay.precision).toBe(6);
    expect(fresh.session.doc.vertices).toEqual([]);
    expect(useProjectStore.getState().previousAction).toBe('new');
    expect(() => parseProjectJson(fresh)).not.toThrow();
    undoWorkspace();
    expect(captureProject()).toEqual(before);
  });
  it('also creates a new identity from an empty graph with metadata', () => {
    createNewProject();
    useProjectStore.getState().setNotes('An empty experiment');
    const before = captureProject();
    createNewProject();
    expect(useProjectStore.getState().metadata.id).not.toBe(before.metadata.id);
    restorePreviousProject();
    expect(captureProject()).toEqual(before);
  });
  it('clears only the canvas, preserving identity, metadata, camera, and Undo/Redo', () => {
    applyProject(parseProjectJson(example), false);
    const before = captureProject();
    useStudioStore.getState().newDocument();
    expect(captureProject().metadata).toEqual(before.metadata);
    expect(captureProject().session.camera2d).toEqual(before.session.camera2d);
    undoWorkspace();
    expect(captureProject()).toEqual(before);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().doc.vertices.size).toBe(0);
  });
});
