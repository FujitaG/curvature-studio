import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SceneLabels, type LabelInput } from '../labels';

let group: THREE.Group, labels: SceneLabels, camera: THREE.PerspectiveCamera;
const records = (count: number): LabelInput[] => Array.from({ length: count }, (_, i) => ({ edgeId: i + 1, text: `0.${i}`, color: '#223344', a: new THREE.Vector3(-1, 0, 0), b: new THREE.Vector3(1, 0, 0) }));
const update = (focusOnly = false, ids: number[] = []) => labels.update({ camera, width: 800, height: 600, enabled: true, focusOnly, hoverKey: null, selection: ids.map(id => ({ kind: 'edge', id })), scale: 1 });
beforeEach(() => {
  group = new THREE.Group(); labels = new SceneLabels(group); camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 1000);
  camera.position.z = 8; camera.updateMatrixWorld();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ measureText: (s: string) => ({ width: s.length * 30 }), strokeText() {}, fillText() {} }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => { labels.dispose(); vi.restoreAllMocks(); });

it('does no projection or glyph work for hidden dense labels, and visits only a selected edge', () => {
  labels.setRecords(records(1500)); update(true);
  expect(labels.stats).toEqual({ visited: 0, projections: 0, visible: 0, textures: 0 });
  update(true, [1200]);
  expect(labels.stats).toEqual({ visited: 1, projections: 2, visible: 1, textures: 1 });
});

it('projects shared endpoints once per frame and keeps glyph textures through temporary hiding', () => {
  const input = records(3);
  input[1].a = input[0].a; input[2].a = input[0].b; input[2].b = input[1].b;
  labels.setRecords(input); update();
  expect(labels.stats.projections).toBe(3);
  const sprites = group.children as THREE.Sprite[], textures = sprites.map(sprite => sprite.material.map);
  update(true); expect(group.children).toHaveLength(0);
  update();
  expect(group.children.map(sprite => (sprite as THREE.Sprite).material.map)).toEqual(textures);
  const sprite = group.children[0] as THREE.Sprite;
  labels.setRecords(input.map(record => ({ ...record, color: '#FF0000' }))); update();
  expect(group.children[0]).toBe(sprite);
  expect(sprite.material.map).not.toBe(textures[0]);
});

it('bounds recently hidden textures and disposes active and cached textures on unmount', () => {
  labels.setRecords(records(1)); update();
  const first = (group.children[0] as THREE.Sprite).material.map!;
  const disposed = vi.fn(); first.addEventListener('dispose', disposed);
  for (let i = 1; i < 220; i++) { labels.setRecords(records(1).map(record => ({ ...record, text: String(i) }))); update(); }
  expect(labels.stats.textures).toBeLessThanOrEqual(129);
  expect(disposed).toHaveBeenCalledOnce();
  const last = (group.children[0] as THREE.Sprite).material.map!;
  const lastDisposed = vi.fn(); last.addEventListener('dispose', lastDisposed);
  labels.dispose();
  expect(group.children).toHaveLength(0); expect(lastDisposed).toHaveBeenCalledOnce();
});
