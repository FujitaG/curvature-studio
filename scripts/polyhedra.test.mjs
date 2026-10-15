import { describe, expect, it } from 'vitest';
import { wythoff, snub, elongatedSquareGyrobicupola, canonicalFaces } from './polyhedra.mjs';

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const distances = points => points.flatMap((a, i) => points.slice(i + 1).map(b => Math.hypot(...a.map((x, j) => x - b[j])))).sort((a, b) => a - b);

describe('independent geometric construction parameters', () => {
  it('solves the two snub equations and closes only the rotational orbit', () => {
    for (const p of [4, 5]) {
      const points = snub(p), seed = points[0];
      expect(points).toHaveLength(p === 4 ? 24 : 60);
      const c = Math.cos(Math.PI / p), s = Math.sin(Math.PI / p);
      const u = [seed[0], dot(seed, [-c, s, 0]), dot(seed, [0, -1 / (2 * s), Math.sqrt(1 - 1 / (4 * s * s))])];
      const t = u[2];
      expect(u[1]).toBeCloseTo(1, 12);
      expect(u[0] ** 2).toBeCloseTo(1 + t, 12);
      const constant = p === 4 ? 2 : ((1 + Math.sqrt(5)) / 2) ** 2;
      expect(Math.abs(t ** 3 - t ** 2 - t + 1 - constant)).toBeLessThan(1e-12);
      const lengths = [u[0] ** 2 + u[1] ** 2 + 2 * c * u[0] * u[1], u[1] ** 2 + u[2] ** 2 + u[1] * u[2], u[0] ** 2 + u[2] ** 2];
      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(1e-12);
    }
  });

  it('recovers the rhombicuboctahedron geometry when the J37 cap twist is undone', () => {
    const cupola = elongatedSquareGyrobicupola().map(([x, y, z]) => z < -1 ? [(x + y) / Math.sqrt(2), (y - x) / Math.sqrt(2), z] : [x, y, z]);
    const actual = distances(cupola), reference = distances(wythoff(4, [0, 2]));
    // Different rigid orientation and unit edge length; compare the full
    // pair-distance multiset, in addition to the catalog's topology tests.
    expect(actual).toHaveLength(reference.length);
    for (let i = 0; i < actual.length; i += 1) expect(actual[i] / actual[0]).toBeCloseTo(reference[i] / reference[0], 10);
    const gyro = distances(elongatedSquareGyrobicupola());
    expect(gyro.some((d, i) => Math.abs(d - actual[i]) > 0.01)).toBe(true);
  });
});

describe('oriented face serialization across arithmetic backends', () => {
  it('ignores cyclic starts and enumeration order but preserves winding', () => {
    const faces = [[12, 4, 5, 13], [23, 22, 12, 13], [1, 4, 3]];
    const expected = [[4, 5, 13, 12], [12, 13, 23, 22], [1, 4, 3]];
    const original = structuredClone(faces);
    expect(canonicalFaces(faces)).toEqual(expected);
    for (let shift = 0; shift < 4; shift += 1) {
      const reordered = faces.map(face => {
        const offset = shift % face.length;
        return [...face.slice(offset), ...face.slice(0, offset)];
      }).reverse();
      expect(canonicalFaces(reordered)).toEqual(expected);
    }
    expect(canonicalFaces(faces.map(face => [...face].reverse()))).not.toEqual(expected);
    expect(faces).toEqual(original);
  });
});
