import { expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneGeometry, positionCylinder } from '../geometry';

it('reuses buffers while preserving edge endpoints under translation, rotation and scaling', () => {
  const pool = new SceneGeometry(), material = new THREE.MeshBasicMaterial();
  const a = new THREE.Vector3(-2, 3, 1), b = new THREE.Vector3(4, -1, 5);
  const first = pool.cylinder(a, b, 0.03, material), second = pool.cylinder(b, a, 0.07, material);
  expect(first.geometry).toBe(second.geometry);
  for (const target of [b, new THREE.Vector3(2, 5, -3), a]) {
    positionCylinder(first, a, target);
    first.updateMatrixWorld();
    expect(new THREE.Vector3(0, -0.5, 0).applyMatrix4(first.matrixWorld).distanceTo(a)).toBeLessThan(1e-12);
    expect(new THREE.Vector3(0, 0.5, 0).applyMatrix4(first.matrixWorld).distanceTo(target)).toBeLessThan(1e-12);
    expect(first.scale.x).toBe(0.03);
    expect(first.geometry).toBe(second.geometry);
  }
  const sphere = pool.sphere(0.05, material), outline = pool.sphere(0.08, material);
  expect(sphere.geometry).toBe(outline.geometry);
  let disposed = 0;
  first.geometry.addEventListener('dispose', () => disposed++);
  sphere.geometry.addEventListener('dispose', () => disposed++);
  pool.dispose();
  expect(disposed).toBe(2);
  material.dispose();
});

it('simplifies small silhouettes only during navigation and keeps picking/export at full detail', () => {
  const pool = new SceneGeometry(), material = new THREE.MeshBasicMaterial();
  const sphere = new THREE.InstancedMesh(pool.sphereGeometry, material, 1);
  sphere.setMatrixAt(0, new THREE.Matrix4().makeScale(0.05, 0.05, 0.05));
  sphere.userData.instanceRadius = 0.05;
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 100);
  camera.position.set(0, 0, 10); camera.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(0.025, 0, 10), new THREE.Vector3(0, 0, -1));
  const originalHit = ray.intersectObject(sphere)[0].point;
  const fullTriangles = sphere.geometry.index!.count / 3;
  expect(pool.preview([sphere], camera, 600, true)).toBe(1);
  const simplified = sphere.geometry;
  expect(simplified.index!.count / 3).toBeLessThan(fullTriangles / 3);
  pool.withFullDetail([sphere], () => {
    expect(sphere.geometry).toBe(pool.sphereGeometry);
    expect(ray.intersectObject(sphere)[0].point.distanceTo(originalHit)).toBeLessThan(1e-12);
  });
  expect(sphere.geometry).toBe(simplified);
  expect(() => pool.withFullDetail([sphere], () => { throw new Error('Export failed'); })).toThrow('Export failed');
  expect(sphere.geometry).toBe(simplified);
  camera.position.z = 0.5; camera.updateMatrixWorld();
  expect(pool.preview([sphere], camera, 600, true)).toBe(0);
  expect(sphere.geometry).toBe(pool.sphereGeometry);
  camera.position.z = 10; camera.updateMatrixWorld();
  pool.preview([sphere], camera, 600, true);
  expect(pool.preview([sphere], camera, 600, false)).toBe(0);
  expect(sphere.geometry).toBe(pool.sphereGeometry);
  const orthographic = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.01, 100);
  orthographic.position.z = 10; orthographic.updateMatrixWorld();
  expect(pool.preview([sphere], orthographic, 600, true)).toBe(1);
  orthographic.zoom = 10; orthographic.updateProjectionMatrix();
  expect(pool.preview([sphere], orthographic, 600, true)).toBe(0);
  pool.dispose(); material.dispose(); sphere.dispose();
});
