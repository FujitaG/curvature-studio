import * as THREE from 'three';
import type { Viewport2d } from '../state/camera2d';

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** Keep the orbit target in the unobscured area without changing graph coordinates. */
export function setCameraViewport(camera: Camera, width: number, height: number, area: Viewport2d): void {
  width = Math.max(1, width); height = Math.max(1, height);
  if (camera instanceof THREE.PerspectiveCamera) camera.aspect = width / height;
  else {
    const halfHeight = (camera.top - camera.bottom) / 2;
    camera.left = -halfHeight * width / height; camera.right = halfHeight * width / height;
  }
  camera.setViewOffset(width, height, width / 2 - area.x - area.width / 2, height / 2 - area.y - area.height / 2, width, height);
  camera.updateProjectionMatrix();
}

export function framePoints(camera: Camera, points: THREE.Vector3[], direction: THREE.Vector3,
  width: number, height: number, area: Viewport2d, padding: number): { target: THREE.Vector3; position: THREE.Vector3 } {
  const sphere = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(1e-8, sphere.radius + padding) * 1.08;
  let distance: number;
  if (camera instanceof THREE.PerspectiveCamera) {
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const tanAvailable = tanY * Math.min(area.width / Math.max(1, height), area.height / Math.max(1, height));
    distance = radius / Math.sin(Math.atan(Math.max(1e-8, tanAvailable)));
  } else {
    const halfHeight = radius * Math.max(height / area.width, height / area.height);
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.zoom = 1;
    distance = radius * 3;
  }
  setCameraViewport(camera, width, height, area);
  const axis = direction.lengthSq() ? direction.clone().normalize() : new THREE.Vector3(4, 3, 6).normalize();
  return { target: sphere.center, position: sphere.center.clone().addScaledVector(axis, distance) };
}

/** Frame an edge's projected extent, rather than its much larger enclosing sphere.
 * Preserve orientation, include endpoint radii, and leave the other pane alone.
 * Perspective inequalities bound padded endpoints against each of the four sides.
 */
export function frameEdge(camera: Camera, points: THREE.Vector3[], direction: THREE.Vector3,
  width: number, height: number, area: Viewport2d, padding: number): { target: THREE.Vector3; position: THREE.Vector3 } {
  if (points.length !== 2 || points[0].distanceToSquared(points[1]) < 1e-20)
    return framePoints(camera, points, direction, width, height, area, padding);
  const target = points[0].clone().add(points[1]).multiplyScalar(0.5);
  const axis = direction.lengthSq() ? direction.clone().normalize() : new THREE.Vector3(4, 3, 6).normalize();
  const rotation = new THREE.Matrix4().lookAt(axis, new THREE.Vector3(), camera.up);
  const right = new THREE.Vector3().setFromMatrixColumn(rotation, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(rotation, 1);
  const offsets = points.map(point => point.clone().sub(target));
  const radius = Math.max(padding, 1e-8);
  let distance: number;
  if (camera instanceof THREE.PerspectiveCamera) {
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    const tx = tanY * area.width / height / 1.08, ty = tanY * area.height / height / 1.08;
    distance = Math.max(...offsets.flatMap(p => [
      p.dot(axis) + (Math.abs(p.dot(right)) + radius * Math.hypot(1, tx)) / tx,
      p.dot(axis) + (Math.abs(p.dot(up)) + radius * Math.hypot(1, ty)) / ty
    ]));
  } else {
    const halfHeight = Math.max(...offsets.flatMap(p => [
      (Math.abs(p.dot(right)) + radius) * height / area.width,
      (Math.abs(p.dot(up)) + radius) * height / area.height
    ])) * 1.08;
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.zoom = 1;
    distance = (points[0].distanceTo(points[1]) / 2 + radius) * 3;
  }
  setCameraViewport(camera, width, height, area);
  return { target, position: target.clone().addScaledVector(axis, distance) };
}

/** Clip distances follow content and navigation, including restored cameras. */
export function updateClipping(camera: Camera, bounds: THREE.Sphere, padding: number): void {
  const radius = Math.max(1e-8, bounds.radius + padding), distance = camera.position.distanceTo(bounds.center);
  const near = Math.max(radius * 1e-4, distance - radius * 2);
  const far = Math.max(near * 1.01, distance + radius * 4);
  if (camera.near !== near || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
}

/** Uniform coordinate scaling should preserve the apparent thickness of a graph. */
export function drawingUnit(positions: Map<number, THREE.Vector3>, edges: Iterable<{ a: number; b: number }>): number {
  const lengths: number[] = [];
  for (const edge of edges) {
    const a = positions.get(edge.a), b = positions.get(edge.b);
    const length = a && b ? a.distanceTo(b) : 0;
    if (length > 1e-12) lengths.push(length);
  }
  lengths.sort((a, b) => a - b);
  if (lengths.length) return Math.max(1e-9, lengths[Math.floor(lengths.length / 2)]);
  const radius = positions.size ? new THREE.Box3().setFromPoints([...positions.values()]).getBoundingSphere(new THREE.Sphere()).radius : 0;
  return radius > 0 ? radius : 1;
}
