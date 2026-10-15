import { describe, expect, it } from 'vitest';
import { parseDmccooey, parsePolyhedronJson, toImportedTemplate } from '../polyhedron';

describe('polyhedron import', () => {
  it('derives unique edges and creates a Tutte layout', () => {
    const poly = parsePolyhedronJson({ format: 'curvature-studio/polyhedron', version: 1, name: 'Tetra', vertices: [[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]], faces: [[0,1,2],[0,3,1],[0,2,3],[1,3,2]] });
    const template = toImportedTemplate(poly);
    expect(template.edges).toHaveLength(6);
    expect(template.layout2d).toHaveLength(4);
    expect(template.approximateLayout).toBe(false);
  });

  it('parses dmccooey constants, vertices, and faces', () => {
    const poly = parseDmccooey('C0 = 0.5 = 1 / 2\nV0 = (C0,0,0)\nV1 = (-C0,0,0)\nV2 = (0,1,0)\nFaces:\n{0,1,2}', 'Tri.txt');
    expect(poly.vertices[0]).toEqual([0.5, 0, 0]);
    expect(poly.edges).toHaveLength(3);
  });

  it('rejects duplicate explicit edges', () => {
    expect(() => parsePolyhedronJson({ format: 'curvature-studio/polyhedron', version: 1, name: 'Bad', vertices: [[0,0,0],[1,0,0]], edges: [[0,1],[1,0]] })).toThrow('Duplicate edge');
  });
});
