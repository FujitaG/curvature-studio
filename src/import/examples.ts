/** These downloadable examples are also exercised through the production importer. */
export const POLYHEDRON_EXAMPLE = {
  format: 'curvature-studio/polyhedron', version: 1, name: 'Example tetrahedron',
  vertices: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]],
  faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
};
export const POLYHEDRON_EXAMPLE_JSON = `{
  "format": "curvature-studio/polyhedron",
  "version": 1,
  "name": "Example tetrahedron",
  "vertices": [
    [1, 1, 1], [-1, -1, 1],
    [-1, 1, -1], [1, -1, -1]
  ],
  "faces": [
    [0, 1, 2], [0, 3, 1],
    [0, 2, 3], [1, 3, 2]
  ]
}\n`;
export const POLYHEDRON_EXAMPLE_TXT = `// Example tetrahedron: supported TXT format
C0 = 1
V0 = ( C0, C0, C0)
V1 = (-C0,-C0, C0)
V2 = (-C0, C0,-C0)
V3 = ( C0,-C0,-C0)
Faces:
{0, 1, 2}
{0, 3, 1}
{0, 2, 3}
{1, 3, 2}
`;
