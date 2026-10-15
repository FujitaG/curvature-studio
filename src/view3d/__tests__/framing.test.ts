import { expect, it } from 'vitest';
import { Box3, Sphere, Vector3 } from 'three';
import { createCamera } from '../camera';
import { drawingUnit, framePoints, updateClipping } from '../framing';
import { availableRectangle } from '../../state/viewport';

const cube = (scale: number) => [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new Vector3(x, y, z).multiplyScalar(scale / 2))));

it.each(['perspective', 'orthographic'] as const)('fits both axes and avoids panels in %s at different coordinate scales', projection => {
  for (const [width, height] of [[320, 844], [390, 844], [1280, 900], [844, 390]]) {
    const area = availableRectangle({ x: 16, y: 16, width: width - 32, height: height - 32 }, [
      { x: 0, y: 0, width, height: height < 500 ? 145 : 225 },
      { x: width - 290, y: height - 240, width: 290, height: 240 }
    ]);
    for (const scale of [0.1, 1, 10, 100, 100000]) {
      const camera = createCamera(projection, width / height), points = cube(scale);
      const direction = camera.position.clone();
      const { position, target } = framePoints(camera, points, direction, width, height, area, scale * 0.08);
      camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld();
      updateClipping(camera, new Box3().setFromPoints(points).getBoundingSphere(new Sphere()), scale * 0.08);
      for (const vertex of points) {
        const p = vertex.clone().project(camera), x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
        expect(x).toBeGreaterThan(area.x); expect(x).toBeLessThan(area.x + area.width);
        expect(y).toBeGreaterThan(area.y); expect(y).toBeLessThan(area.y + area.height);
        expect(Math.abs(p.z)).toBeLessThan(1);
      }
    }
  }
});

it('uses edge lengths for drawing thickness without changing coordinates', () => {
  for (const scale of [0.1, 1, 10, 100]) {
    const positions = new Map([[1, new Vector3(0, 0, 0)], [2, new Vector3(scale, 0, 0)], [3, new Vector3(scale, scale, 0)]]);
    expect(drawingUnit(positions, [{ a: 1, b: 2 }, { a: 2, b: 3 }])).toBe(scale);
    expect(positions.get(2)!.x).toBe(scale);
  }
});

it.each(['perspective', 'orthographic'] as const)('locates the Cube edge in a 234 × 63px %s gap at readable size', async projection => {
  const { frameEdge } = await import('../framing');
  const width = 266, height = 546, area = { x: 16, y: 16, width: 234, height: 63.44 };
  for (const scale of [0.1, 1, 10, 100]) {
    const camera = createCamera(projection, width / height);
    const points = [new Vector3(-0.5, -0.5, -0.5), new Vector3(-0.5, -0.5, 0.5)].map(p => p.multiplyScalar(scale));
    const original = points.map(p => p.toArray());
    const { position, target } = frameEdge(camera, points, camera.position, width, height, area, scale * 0.08);
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld();
    const projected = points.map(p => p.clone().project(camera)).map(p => ({ x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }));
    expect(Math.hypot(projected[1].x - projected[0].x, projected[1].y - projected[0].y)).toBeGreaterThanOrEqual(48);
    for (const p of projected) {
      expect(p.x).toBeGreaterThan(area.x); expect(p.x).toBeLessThan(area.x + area.width);
      expect(p.y).toBeGreaterThan(area.y); expect(p.y).toBeLessThan(area.y + area.height);
    }
    expect(points.map(p => p.toArray())).toEqual(original);
    expect(camera.position.clone().sub(target).normalize().distanceTo(new Vector3(4, 3, 6).normalize())).toBeLessThan(1e-10);
  }
});
