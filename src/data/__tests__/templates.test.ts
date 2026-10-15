import { describe, expect, it } from 'vitest';
import baked from '../templates.json';
import type { Template } from '../templates';
import { templates } from '../templates';
import { quickTemplates } from '../quickTemplates';

const expected = new Map<string, { v: number; e: number; degrees: number[] }>([
  ['tetrahedron', { v: 4, e: 6, degrees: [3] }],
  ['cube', { v: 8, e: 12, degrees: [3] }],
  ['octahedron', { v: 6, e: 12, degrees: [4] }],
  ['dodecahedron', { v: 20, e: 30, degrees: [3] }],
  ['icosahedron', { v: 12, e: 30, degrees: [5] }],
  ['rhombic-dodecahedron', { v: 14, e: 24, degrees: [3, 4] }],
  ['truncated-tetrahedron', { v: 12, e: 18, degrees: [3] }],
  ['cuboctahedron', { v: 12, e: 24, degrees: [4] }],
  ['truncated-cube', { v: 24, e: 36, degrees: [3] }],
  ['truncated-octahedron', { v: 24, e: 36, degrees: [3] }],
  ['rhombicuboctahedron', { v: 24, e: 48, degrees: [4] }],
  ['pseudo-rhombicuboctahedron-j37', { v: 24, e: 48, degrees: [4] }],
  ['truncated-cuboctahedron', { v: 48, e: 72, degrees: [3] }],
  ['snub-cube', { v: 24, e: 60, degrees: [5] }],
  ['icosidodecahedron', { v: 30, e: 60, degrees: [4] }],
  ['truncated-dodecahedron', { v: 60, e: 90, degrees: [3] }],
  ['truncated-icosahedron', { v: 60, e: 90, degrees: [3] }],
  ['rhombicosidodecahedron', { v: 60, e: 120, degrees: [4] }],
  ['truncated-icosidodecahedron', { v: 120, e: 180, degrees: [3] }],
  ['snub-dodecahedron', { v: 60, e: 150, degrees: [5] }]
]);

function orientation(a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function between(a: number[], b: number[], c: number[]): boolean {
  return Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function properIntersection(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (Math.abs(o1) <= 1e-9 && between(a, b, c)) return false;
  if (Math.abs(o2) <= 1e-9 && between(a, b, d)) return false;
  if (Math.abs(o3) <= 1e-9 && between(c, d, a)) return false;
  if (Math.abs(o4) <= 1e-9 && between(c, d, b)) return false;
  return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
}

describe('baked fixed templates', () => {
  it('has the defining face inventory, regular faces, and a closed convex surface', () => {
    // Counts follow the classical vertex figures (n-gon incidences / n),
    // not a snapshot of a coordinate file. This distinguishes, for example,
    // truncated cube and truncated octahedron although both have V=24,E=36.
    const faceCounts: Record<string, Record<number, number>> = {
      tetrahedron: { 3: 4 }, cube: { 4: 6 }, octahedron: { 3: 8 },
      dodecahedron: { 5: 12 }, icosahedron: { 3: 20 },
      'rhombic-dodecahedron': { 4: 12 },
      'truncated-tetrahedron': { 3: 4, 6: 4 }, cuboctahedron: { 3: 8, 4: 6 },
      'truncated-cube': { 3: 8, 8: 6 }, 'truncated-octahedron': { 4: 6, 6: 8 },
      rhombicuboctahedron: { 3: 8, 4: 18 }, 'pseudo-rhombicuboctahedron-j37': { 3: 8, 4: 18 },
      'truncated-cuboctahedron': { 4: 12, 6: 8, 8: 6 }, 'snub-cube': { 3: 32, 4: 6 },
      icosidodecahedron: { 3: 20, 5: 12 }, 'truncated-dodecahedron': { 3: 20, 10: 12 },
      'truncated-icosahedron': { 5: 12, 6: 20 }, rhombicosidodecahedron: { 3: 20, 4: 30, 5: 12 },
      'truncated-icosidodecahedron': { 4: 30, 6: 20, 10: 12 }, 'snub-dodecahedron': { 3: 80, 5: 12 }
    };
    const subtract = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    for (const t of baked) {
      const counts: Record<number, number> = {}, incidence = new Map<string, number[]>();
      for (const face of t.faces) {
        counts[face.length] = (counts[face.length] ?? 0) + 1;
        expect(new Set(face).size, t.id).toBe(face.length);
        const points = face.map(i => t.vertices3d[i]);
        const centre = [0, 1, 2].map(axis => points.reduce((s, p) => s + p[axis], 0) / points.length);
        const raw = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
        const normal = raw.map(x => x / Math.hypot(...raw));
        for (const point of t.vertices3d) {
          expect(dot(subtract(point, centre), normal), `${t.id}: convex support plane`).toBeLessThanOrEqual(1e-8);
        }
        for (let i = 0; i < face.length; i += 1) {
          const a = face[i], b = face[(i + 1) % face.length], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
          incidence.set(key, [...(incidence.get(key) ?? []), Math.sign(b - a)]);
          expect(Math.hypot(...subtract(t.vertices3d[a], t.vertices3d[b])), `${t.id}: unit edge`).toBeCloseTo(1, 8);
          expect(Math.abs(dot(subtract(points[i], centre), normal)), `${t.id}: planar face`).toBeLessThan(1e-8);
          if (t.id !== 'rhombic-dodecahedron') {
            const u = subtract(points[(i + face.length - 1) % face.length], points[i]);
            const v = subtract(points[(i + 1) % face.length], points[i]);
            expect(dot(u, v) / (Math.hypot(...u) * Math.hypot(...v)), `${t.id}: regular face angle`)
              .toBeCloseTo(-Math.cos(2 * Math.PI / face.length), 8);
          }
        }
      }
      expect(counts, t.id).toEqual(faceCounts[t.id]);
      expect(incidence.size, t.id).toBe(t.edges.length);
      for (const [a, b] of t.edges) {
        const directions = incidence.get(`${Math.min(a, b)}:${Math.max(a, b)}`);
        expect(directions?.sort(), `${t.id}: two oppositely oriented incident faces`).toEqual([-1, 1]);
      }
      for (let a = 0; a < t.vertices3d.length; a += 1) {
        for (let b = a + 1; b < t.vertices3d.length; b += 1) {
          const distance = Math.hypot(...subtract(t.vertices3d[a], t.vertices3d[b]));
          if (!incidence.has(`${a}:${b}`)) expect(distance, `${t.id}: non-edge separation`).toBeGreaterThan(1.001);
        }
      }
      if (t.id !== 'rhombic-dodecahedron') {
        const figures = t.vertices3d.map((_, id) => t.faces.filter(face => face.includes(id)).map(face => face.length).sort((a, b) => a - b).join('.'));
        expect(new Set(figures).size, `${t.id}: face incidence at each vertex`).toBe(1);
      }
    }
  });
  it('keeps the initial canvas templates identical to the deferred catalog', () => {
    expect(quickTemplates.map(template => template.id).sort()).toEqual(['cube', 'k4', 'rhombic-dodecahedron']);
    for (const template of quickTemplates) expect(template).toEqual(templates.find(candidate => candidate.id === template.id));
  });
  it('contains every fixed solid with validated topology and planar layout', () => {
    const templates = baked as Template[];
    expect(templates).toHaveLength(20);
    expect(new Set(templates.map((template) => template.id))).toEqual(new Set(expected.keys()));
    expect(templates.findIndex((template) => template.id === 'pseudo-rhombicuboctahedron-j37')).toBe(templates.findIndex((template) => template.id === 'rhombicuboctahedron') + 1);

    for (const template of templates) {
      const item = expected.get(template.id);
      expect(item, template.id).toBeDefined();
      expect(template.vertices3d, template.id).toHaveLength(item!.v);
      expect(template.layout2d, template.id).toHaveLength(item!.v);
      expect(template.edges, template.id).toHaveLength(item!.e);
      expect(template.faces, template.id).toBeDefined();
      expect(item!.v - item!.e + template.faces!.length, template.id).toBe(2);

      const degrees = Array.from({ length: template.vertices3d.length }, () => 0);
      for (const [a, b] of template.edges) {
        degrees[a] += 1;
        degrees[b] += 1;
      }
      expect([...new Set(degrees)].sort((a, b) => a - b), template.id).toEqual(item!.degrees);

      let minPairwise = Number.POSITIVE_INFINITY;
      for (let i = 0; i < template.layout2d.length; i += 1) {
        for (let j = i + 1; j < template.layout2d.length; j += 1) {
          minPairwise = Math.min(minPairwise, Math.hypot(template.layout2d[i][0] - template.layout2d[j][0], template.layout2d[i][1] - template.layout2d[j][1]));
        }
      }
      expect(minPairwise, template.id).toBeGreaterThanOrEqual(0.05 * 64);

      for (let i = 0; i < template.edges.length; i += 1) {
        for (let j = i + 1; j < template.edges.length; j += 1) {
          const [a, b] = template.edges[i];
          const [c, d] = template.edges[j];
          if (a === c || a === d || b === c || b === d) continue;
          expect(properIntersection(template.layout2d[a], template.layout2d[b], template.layout2d[c], template.layout2d[d]), `${template.id}: ${a}-${b} crosses ${c}-${d}`).toBe(false);
        }
      }
    }
  });
});
