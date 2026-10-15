import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);

/** Reuse vertex buffers across edges, vertices and transient editing overlays. */
export class SceneGeometry {
  readonly cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
  readonly sphereGeometry = new THREE.SphereGeometry(1, 18, 12);
  private simpleCylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  private simpleSphere = new THREE.SphereGeometry(1, 8, 6);
  private center = new THREE.Vector3();

  constructor() {
    this.cylinderGeometry.userData.shared = true;
    this.sphereGeometry.userData.shared = true;
    this.simpleCylinder.userData.shared = true;
    this.simpleSphere.userData.shared = true;
  }

  cylinder(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.cylinderGeometry, material);
    mesh.scale.set(radius, 1, radius);
    positionCylinder(mesh, a, b);
    return mesh;
  }

  sphere(radius: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.sphereGeometry, material);
    mesh.scale.setScalar(radius);
    return mesh;
  }

  /** Small silhouettes only, during interaction. Resting views retain full geometry. */
  preview(objects: THREE.Object3D[], camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, height: number, enabled: boolean): number {
    let simplified = 0;
    for (const object of objects) {
      if (!(object instanceof THREE.InstancedMesh)) continue;
      const full = this.fullGeometry(object.geometry);
      if (full !== this.sphereGeometry && full !== this.cylinderGeometry) continue;
      let small = false;
      if (enabled) {
        if (!object.boundingSphere) object.computeBoundingSphere();
        const bounds = object.boundingSphere!;
        this.center.copy(bounds.center).applyMatrix4(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        const nearestDepth = -this.center.z - bounds.radius;
        const radius = Number(object.userData.instanceRadius ?? Infinity);
        const pixels = camera instanceof THREE.PerspectiveCamera
          ? nearestDepth > camera.near ? radius * height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * nearestDepth) : Infinity
          : radius * height * camera.zoom / (camera.top - camera.bottom);
        small = pixels <= 5;
      }
      object.geometry = small ? full === this.sphereGeometry ? this.simpleSphere : this.simpleCylinder : full;
      if (small) simplified++;
    }
    return simplified;
  }

  private fullGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    return geometry === this.simpleSphere ? this.sphereGeometry : geometry === this.simpleCylinder ? this.cylinderGeometry : geometry;
  }

  /** Picking and image export always use the original geometry, even mid-gesture. */
  withFullDetail<T>(objects: THREE.Object3D[], action: () => T): T {
    const swapped: Array<[THREE.Mesh, THREE.BufferGeometry]> = [];
    for (const object of objects) if (object instanceof THREE.Mesh) {
      const full = this.fullGeometry(object.geometry);
      if (full !== object.geometry) { swapped.push([object, object.geometry]); object.geometry = full; }
    }
    try { return action(); } finally { for (const [mesh, geometry] of swapped) mesh.geometry = geometry; }
  }

  dispose() {
    this.cylinderGeometry.dispose();
    this.sphereGeometry.dispose();
    this.simpleCylinder.dispose();
    this.simpleSphere.dispose();
  }
}

export function positionCylinder(mesh: Pick<THREE.Object3D, 'position' | 'scale' | 'quaternion'>, a: THREE.Vector3, b: THREE.Vector3): void {
  const delta = new THREE.Vector3().subVectors(b, a);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.y = delta.length();
  mesh.quaternion.setFromUnitVectors(up, delta.lengthSq() ? delta.normalize() : up);
}
