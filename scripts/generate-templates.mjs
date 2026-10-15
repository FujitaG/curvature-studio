import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedSolids } from './polyhedra.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/data/templates.json');
const EPS = 1e-6;
const LAYOUT_SCALE = 64;

const phi = (1 + Math.sqrt(5)) / 2;

const handExpected = new Map([
  ['tetrahedron', { v: 4, e: 6, degrees: [3] }],
  ['cube', { v: 8, e: 12, degrees: [3] }],
  ['octahedron', { v: 6, e: 12, degrees: [4] }],
  ['dodecahedron', { v: 20, e: 30, degrees: [3] }],
  ['icosahedron', { v: 12, e: 30, degrees: [5] }],
  ['rhombic-dodecahedron', { v: 14, e: 24, degrees: [3, 4] }]
]);

function signs(values) {
  const result = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) result.push([sx * values[0], sy * values[1], sz * values[2]]);
  return result;
}

function cyclicPermutations([a, b, c]) {
  return [
    [a, b, c],
    [b, c, a],
    [c, a, b]
  ];
}

function uniquePoints(points) {
  const seen = new Set();
  const result = [];
  for (const p of points) {
    const key = p.map((x) => x.toFixed(12)).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalizeVector(a) {
  const n = norm(a);
  if (n < 1e-12) throw new Error('Cannot normalize zero vector');
  return mul(a, 1 / n);
}

function distance(a, b) {
  return norm(sub(a, b));
}

function centroid(points) {
  return mul(points.reduce((sum, p) => add(sum, p), [0, 0, 0]), 1 / points.length);
}

function minDistance(points) {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = distance(points[i], points[j]);
      if (d > 1e-9 && d < min) min = d;
    }
  }
  return min;
}

function scaleToUnitEdges(points) {
  const d = minDistance(points);
  return points.map((p) => mul(p, 1 / d));
}

function edgesByMinDistance(points, tolerance = EPS) {
  const d = minDistance(points);
  const edges = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(distance(points[i], points[j]) - d) <= tolerance) edges.push([i, j]);
    }
  }
  return edges;
}

function handSolidDefinitions() {
  const icosaPoints = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) icosaPoints.push(...cyclicPermutations([0, a, b]));
  const dodecaPoints = [...signs([1, 1, 1])];
  for (const a of [-1 / phi, 1 / phi]) for (const b of [-phi, phi]) dodecaPoints.push(...cyclicPermutations([0, a, b]));
  return [
    {
      id: 'tetrahedron',
      group: 'Platonic',
      label: 'Tetrahedron',
      vertices3d: [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1]
      ]
    },
    { id: 'cube', group: 'Platonic', label: 'Cube', vertices3d: signs([1, 1, 1]) },
    {
      id: 'octahedron',
      group: 'Platonic',
      label: 'Octahedron',
      vertices3d: [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ]
    },
    { id: 'dodecahedron', group: 'Platonic', label: 'Dodecahedron', vertices3d: dodecaPoints },
    { id: 'icosahedron', group: 'Platonic', label: 'Icosahedron', vertices3d: icosaPoints },
    {
      id: 'rhombic-dodecahedron',
      group: 'Catalan',
      label: 'Rhombic dodecahedron',
      vertices3d: [
        ...signs([1, 1, 1]),
        [2, 0, 0],
        [-2, 0, 0],
        [0, 2, 0],
        [0, -2, 0],
        [0, 0, 2],
        [0, 0, -2]
      ]
    }
  ];
}

function supportingPlaneFaces(points) {
  const center = centroid(points);
  const faces = new Map();
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      for (let k = j + 1; k < points.length; k += 1) {
        let normal = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        if (norm(normal) < 1e-9) continue;
        normal = normalizeVector(normal);
        const coplanar = [];
        let positive = false;
        let negative = false;
        for (let v = 0; v < points.length; v += 1) {
          const side = dot(normal, sub(points[v], points[i]));
          if (Math.abs(side) <= EPS) coplanar.push(v);
          else if (side > 0) positive = true;
          else negative = true;
        }
        if (coplanar.length < 3 || (positive && negative)) continue;
        const key = [...coplanar].sort((a, b) => a - b).join(',');
        if (faces.has(key)) continue;
        const faceCenter = centroid(coplanar.map((index) => points[index]));
        if (dot(normal, sub(faceCenter, center)) < 0) normal = mul(normal, -1);
        const u = normalizeVector(sub(points[coplanar[0]], faceCenter));
        const vAxis = cross(normal, u);
        const ordered = [...coplanar].sort((a, b) => {
          const da = sub(points[a], faceCenter);
          const db = sub(points[b], faceCenter);
          return Math.atan2(dot(da, vAxis), dot(da, u)) - Math.atan2(dot(db, vAxis), dot(db, u));
        });
        faces.set(key, ordered);
      }
    }
  }
  return [...faces.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function adjacency(vertexCount, edges) {
  const adj = Array.from({ length: vertexCount }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj.map((list) => list.sort((a, b) => a - b));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('Tutte solve encountered singular matrix');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let c = col; c <= n; c += 1) a[col][c] /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-14) continue;
      for (let c = col; c <= n; c += 1) a[row][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row[n]);
}

function tutteLayout(vertexCount, edges, faces) {
  const adj = adjacency(vertexCount, edges);
  const outer = faces.reduce((best, face) => (face.length > best.length ? face : best), faces[0]);
  const boundary = new Set(outer);
  const layout = Array.from({ length: vertexCount }, () => [0, 0]);
  for (let i = 0; i < outer.length; i += 1) {
    const angle = Math.PI / 2 + (2 * Math.PI * i) / outer.length;
    layout[outer[i]] = [Math.cos(angle), Math.sin(angle)];
  }
  const interior = [];
  const indexOf = new Map();
  for (let i = 0; i < vertexCount; i += 1) {
    if (!boundary.has(i)) {
      indexOf.set(i, interior.length);
      interior.push(i);
    }
  }
  if (interior.length > 0) {
    const matrix = Array.from({ length: interior.length }, () => Array.from({ length: interior.length }, () => 0));
    const bx = Array.from({ length: interior.length }, () => 0);
    const by = Array.from({ length: interior.length }, () => 0);
    for (const vertex of interior) {
      const row = indexOf.get(vertex);
      const neighbors = adj[vertex];
      matrix[row][row] = 1;
      for (const neighbor of neighbors) {
        const weight = 1 / neighbors.length;
        if (boundary.has(neighbor)) {
          bx[row] += weight * layout[neighbor][0];
          by[row] += weight * layout[neighbor][1];
        } else {
          matrix[row][indexOf.get(neighbor)] -= weight;
        }
      }
    }
    const xs = solveLinearSystem(matrix, bx);
    const ys = solveLinearSystem(matrix, by);
    for (let i = 0; i < interior.length; i += 1) layout[interior[i]] = [xs[i], ys[i]];
  }
  const edgeLengths = edges.map(([a, b]) => Math.hypot(layout[a][0] - layout[b][0], layout[a][1] - layout[b][1]));
  const scale = 1 / median(edgeLengths);
  return layout.map(([x, y]) => [x * scale, -y * scale]);
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function between(a, b, c) {
  return Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function properIntersection(a, b, c, d) {
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

function validateLayout(id, layout, edges) {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < layout.length; i += 1) {
    for (let j = i + 1; j < layout.length; j += 1) {
      min = Math.min(min, Math.hypot(layout[i][0] - layout[j][0], layout[i][1] - layout[j][1]));
    }
  }
  if (min < 0.05) throw new Error(`${id}: 2D layout has near-coincident vertices, min=${min}`);
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (properIntersection(layout[a], layout[b], layout[c], layout[d])) {
        throw new Error(`${id}: 2D layout has crossing edges ${a}-${b} and ${c}-${d}`);
      }
    }
  }
}

function validateTopology(id, vertices, edges, faces, expected) {
  if (vertices.length !== expected.v) throw new Error(`${id}: expected ${expected.v} vertices, got ${vertices.length}`);
  if (edges.length !== expected.e) throw new Error(`${id}: expected ${expected.e} edges, got ${edges.length}`);
  const degrees = adjacency(vertices.length, edges).map((neighbors) => neighbors.length);
  const uniqueDegrees = [...new Set(degrees)].sort((a, b) => a - b);
  if (uniqueDegrees.join(',') !== expected.degrees.join(',')) throw new Error(`${id}: expected degree set ${expected.degrees}, got ${uniqueDegrees}`);
  if (vertices.length - edges.length + faces.length !== 2) {
    throw new Error(`${id}: Euler check failed with V=${vertices.length}, E=${edges.length}, F=${faces.length}`);
  }
  const edgeSet = new Set(edges.map(([a, b]) => edgeKey(a, b)));
  for (const face of faces) {
    for (let i = 0; i < face.length; i += 1) {
      if (!edgeSet.has(edgeKey(face[i], face[(i + 1) % face.length]))) {
        throw new Error(`${id}: face contains non-edge ${face[i]}-${face[(i + 1) % face.length]}`);
      }
    }
  }
}

function makeTemplate(definition, expected) {
  const vertices3d = scaleToUnitEdges(uniquePoints(definition.vertices3d));
  const edges = edgesByMinDistance(vertices3d);
  const faces = supportingPlaneFaces(vertices3d);
  validateTopology(definition.id, vertices3d, edges, faces, expected);
  const layout = tutteLayout(vertices3d.length, edges, faces);
  validateLayout(definition.id, layout, edges);
  return {
    id: definition.id,
    group: definition.group,
    label: definition.label,
    vertices3d: vertices3d.map((p) => p.map(roundNumber)),
    edges,
    faces,
    layout2d: layout.map(([x, y]) => [roundNumber(x * LAYOUT_SCALE), roundNumber(y * LAYOUT_SCALE)])
  };
}

function roundNumber(value) {
  return Number(value.toFixed(10));
}

const fixedTemplates = [];
for (const hand of handSolidDefinitions()) {
  fixedTemplates.push(makeTemplate(hand, handExpected.get(hand.id)));
}

for (const [id, label, generate, v, e, degree] of generatedSolids) {
  fixedTemplates.push(makeTemplate({ id, group: 'Archimedean', label, vertices3d: generate() }, { v, e, degrees: [degree] }));
}

// --check is read-only: CI detects stale or hand-edited generated data.
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: npm run bake [-- --check]');
for (const [path, data] of [
  [target, fixedTemplates],
  [resolve(here, '../src/data/quickTemplates.json'), fixedTemplates.filter(t => ['cube', 'rhombic-dodecahedron'].includes(t.id))]
]) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (check) {
    if (readFileSync(path, 'utf8') !== text) throw new Error(`${path}: stale catalog; run npm run bake`);
  } else writeFileSync(path, text);
}
console.log(`${check ? 'verified' : 'generated'} ${fixedTemplates.length} fixed templates from geometric constructions`);
