import * as THREE from 'three';
import type { SelectionItem } from '../state/types';

const matrix = new THREE.Matrix4();
const records = new WeakMap<THREE.Object3D, GeometryInstance[]>();

/** A transform handle, not an extra scene object or draw call. */
export class GeometryInstance {
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  scale = new THREE.Vector3(1, 1, 1);
  mesh!: THREE.InstancedMesh;
  index = 0;
  constructor(readonly userData: SelectionItem | null, readonly color?: THREE.Color) {}
  write(): void {
    this.mesh.setMatrixAt(this.index, matrix.compose(this.position, this.quaternion, this.scale));
    this.mesh.instanceMatrix.addUpdateRange(this.index * 16, 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    // Both culling and raycasting must include vertices moved outside the old bounds.
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
  }
}

export function instancesFor(object: THREE.Object3D): readonly GeometryInstance[] { return records.get(object) ?? []; }

export function selectionForHit(hit: THREE.Intersection | undefined): SelectionItem | null {
  if (!hit || hit.instanceId === undefined) return null;
  return records.get(hit.object)?.[hit.instanceId]?.userData ?? null;
}

/** Separate incompatible materials; use per-instance colors for curvature bonds. */
export class SceneBatches {
  private buckets = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; instances: GeometryInstance[] }>();
  add(geometry: THREE.BufferGeometry, material: THREE.Material, item: SelectionItem | null, color?: THREE.Color): GeometryInstance {
    const key = `${geometry.id}:${material.id}`;
    let bucket = this.buckets.get(key);
    if (!bucket) { bucket = { geometry, material, instances: [] }; this.buckets.set(key, bucket); }
    const instance = new GeometryInstance(item, color);
    bucket.instances.push(instance);
    return instance;
  }
  finish(group: THREE.Group): THREE.InstancedMesh[] {
    const pickables: THREE.InstancedMesh[] = [];
    for (const { geometry, material, instances } of this.buckets.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.instanceRadius = instances.reduce((radius, instance) => Math.max(radius, instance.scale.x, instance.scale.z), 0);
      instances.forEach((instance, index) => {
        instance.mesh = mesh; instance.index = index;
        mesh.setMatrixAt(index, matrix.compose(instance.position, instance.quaternion, instance.scale));
        if (instance.color) mesh.setColorAt(index, instance.color);
      });
      records.set(mesh, instances);
      group.add(mesh);
      if (instances.some(instance => instance.userData)) pickables.push(mesh);
    }
    return pickables;
  }
}
