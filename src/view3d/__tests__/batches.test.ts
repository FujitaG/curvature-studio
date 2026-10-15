import { expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneBatches, selectionForHit } from '../batches';
import { SceneGeometry } from '../geometry';

it('renders 1,000 separately pickable vertices as one mesh and updates moved bounds', () => {
  const geometry = new SceneGeometry(), batches = new SceneBatches(), group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const handles = Array.from({ length: 1000 }, (_, id) => {
    const handle = batches.add(geometry.sphereGeometry, material, { kind: 'vertex', id }, new THREE.Color(id % 2 ? '#ff0000' : '#0000ff'));
    handle.position.set(id * 3, 0, 0); return handle;
  });
  const pickables = batches.finish(group);
  expect(group.children).toHaveLength(1);
  expect(pickables[0].count).toBe(1000);
  const color = new THREE.Color(); pickables[0].getColorAt(1, color);
  expect(color.getHexString()).toBe('ff0000');
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
  expect(selectionForHit(ray.intersectObjects(pickables)[0])).toEqual({ kind: 'vertex', id: 0 });
  handles[0].position.set(-100, 0, 0); handles[0].write();
  ray.set(new THREE.Vector3(-100, 0, 10), new THREE.Vector3(0, 0, -1));
  expect(selectionForHit(ray.intersectObjects(pickables)[0])).toEqual({ kind: 'vertex', id: 0 });
  ray.set(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
  expect(selectionForHit(ray.intersectObjects(pickables)[0])).toBeNull();
  pickables[0].dispose(); material.dispose(); geometry.dispose();
});
