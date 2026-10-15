import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { templates } from '../../data/templates';
import { createCamera } from '../camera';

describe('initial 3D view', () => {
  it.each(['perspective', 'orthographic'] as const)('keeps front and back cube vertices distinguishable in %s projection without WebGL', (projection) => {
    const camera = createCamera(projection, 4 / 3);
    camera.updateMatrixWorld();
    const points = templates.find((entry) => entry.id === 'cube')!.vertices3d.map((p) => new Vector3(...p).project(camera));
    expect(points).toHaveLength(8);
    for (let i = 0; i < points.length; i++) {
      expect(Math.abs(points[i].x)).toBeLessThan(1);
      expect(Math.abs(points[i].y)).toBeLessThan(1);
      for (let j = i + 1; j < points.length; j++) expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThan(0.01);
    }
  });
});
