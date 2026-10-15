import * as THREE from 'three';
import type { ProjectionMode } from '../state/types';

/** An oblique default exposes depth; saved cameras are restored by the view. */
export function createCamera(projection: ProjectionMode, aspect: number): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  if (projection === 'orthographic') {
    const halfHeight = 3;
    const camera = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, 1000);
    camera.position.set(4, 3, 6);
    camera.lookAt(0, 0, 0);
    return camera;
  }
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 1000);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0, 0);
  return camera;
}
