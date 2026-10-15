import { describe, expect, it } from 'vitest';
import { parsePolyhedronJson, parseDmccooey } from '../polyhedron';
import { POLYHEDRON_EXAMPLE, POLYHEDRON_EXAMPLE_JSON, POLYHEDRON_EXAMPLE_TXT } from '../examples';
describe('downloadable polyhedron examples', () => {
  it('describes the same tetrahedron in JSON and supported TXT', () => {
    expect(JSON.parse(POLYHEDRON_EXAMPLE_JSON)).toEqual(POLYHEDRON_EXAMPLE);
    const json = parsePolyhedronJson(JSON.parse(POLYHEDRON_EXAMPLE_JSON));
    const txt = parseDmccooey(POLYHEDRON_EXAMPLE_TXT, 'Example tetrahedron.txt');
    expect(txt).toEqual(json); expect(json.vertices).toHaveLength(4); expect(json.edges).toHaveLength(6); expect(json.faces).toHaveLength(4);
  });
  it('uses explicit edges when both fields exist, as the guide states', () => {
    const graph = parsePolyhedronJson({ ...POLYHEDRON_EXAMPLE, edges: [[0, 1]] });
    expect(graph.edges).toEqual([[0, 1]]);
    expect(() => parsePolyhedronJson({ ...POLYHEDRON_EXAMPLE, faces: [[0, 1, 2, 0]] })).toThrow(/repeats/);
  });
});
