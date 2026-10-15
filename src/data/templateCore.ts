import { UNIT_EDGE_WEIGHT } from '../graph/edge';
import type { Edge } from '../state/types';
import { allocateIds } from '../state/ids';

export interface Template {
  id: string;
  group: string;
  label: string;
  vertices3d: Array<[number, number, number]>;
  edges: Array<[number, number]>;
  faces?: number[][];
  braceEdges?: Array<[number, number]>;
  layout2d: Array<[number, number]>;
  parametric?: 'cycle' | 'prism' | 'antiprism';
  minN?: number;
  maxN?: number;
  defaultN?: number;
}

export function cycleTemplate(n: number): Template {
  const radius = 1 / (2 * Math.sin(Math.PI / n));
  const points = Array.from({ length: n }, (_, i): [number, number, number] => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return [radius * Math.cos(a), radius * Math.sin(a), 0];
  });
  return {
    id: `cycle-${n}`,
    group: 'Rings & prisms',
    label: `Cycle C${n}`,
    vertices3d: points,
    edges: Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]),
    layout2d: points.map(([x, y]) => [x * 64, y * 64])
  };
}

export function prismTemplate(n: number): Template {
  const radius = 1 / (2 * Math.sin(Math.PI / n));
  const top: Array<[number, number, number]> = [];
  const bottom: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    top.push([radius * Math.cos(a), radius * Math.sin(a), 0.5]);
    bottom.push([radius * Math.cos(a), radius * Math.sin(a), -0.5]);
  }
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    edges.push([i, (i + 1) % n], [n + i, n + ((i + 1) % n)], [i, n + i]);
  }
  return {
    id: `prism-${n}`,
    group: 'Rings & prisms',
    label: `Prism ${n}`,
    vertices3d: [...top, ...bottom],
    edges,
    layout2d: [
      ...top.map(([x, y]) => [x * 64, y * 64] as [number, number]),
      ...bottom.map(([x, y]) => [x * 35, y * 35] as [number, number])
    ]
  };
}

export function antiprismTemplate(n: number): Template {
  const r = 1 / (2 * Math.sin(Math.PI / n));
  const h = Math.sqrt(Math.max(0.05, 1 - 4 * r * r * Math.sin(Math.PI / (2 * n)) ** 2));
  const top: Array<[number, number, number]> = [];
  const bottom: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    const b = a + Math.PI / n;
    top.push([r * Math.cos(a), r * Math.sin(a), h / 2]);
    bottom.push([r * Math.cos(b), r * Math.sin(b), -h / 2]);
  }
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    edges.push([i, (i + 1) % n], [n + i, n + ((i + 1) % n)], [i, n + i], [i, n + ((i + n - 1) % n)]);
  }
  return {
    id: `antiprism-${n}`,
    group: 'Rings & prisms',
    label: `Antiprism ${n}`,
    vertices3d: [...top, ...bottom],
    edges,
    layout2d: [
      ...top.map(([x, y]) => [x * 64, y * 64] as [number, number]),
      ...bottom.map(([x, y]) => [x * 35, y * 35] as [number, number])
    ]
  };
}

function k2(): Template {
  return {
    id: 'k2',
    group: 'Theory examples',
    label: 'Single bond',
    vertices3d: [
      [-0.5, 0, 0],
      [0.5, 0, 0]
    ],
    edges: [[0, 1]],
    layout2d: [
      [-64, 0],
      [64, 0]
    ]
  };
}

function p3(): Template {
  return {
    id: 'p3',
    group: 'Theory examples',
    label: 'Path P3',
    vertices3d: [
      [-1, 0, 0],
      [0, 0, 0],
      [0.5, Math.sqrt(3) / 2, 0]
    ],
    edges: [
      [0, 1],
      [1, 2]
    ],
    layout2d: [
      [-64, 38],
      [0, 38],
      [32, -18]
    ]
  };
}

export function k4(): Template {
  return {
    id: 'k4',
    group: 'Theory examples',
    label: 'K4',
    vertices3d: [
      [0.3535533906, 0.3535533906, 0.3535533906],
      [0.3535533906, -0.3535533906, -0.3535533906],
      [-0.3535533906, 0.3535533906, -0.3535533906],
      [-0.3535533906, -0.3535533906, 0.3535533906]
    ],
    edges: [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3]
    ],
    layout2d: [
      [0, -74],
      [72, 42],
      [-72, 42],
      [0, 0]
    ]
  };
}

function bridgeTemplate(): Template {
  const s = 1 / (2 * Math.sqrt(2));
  const dx = s + 0.5;
  const tetra: Array<[number, number, number]> = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1]
  ].map(([x, y, z]) => [x * s - dx, y * s, z * s]);
  const mirrored: Array<[number, number, number]> = tetra.map(([x, y, z]) => [-x, y, z]);
  const edges: Array<[number, number]> = [];
  for (let offset of [0, 4]) {
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 4; j += 1) edges.push([offset + i, offset + j]);
    }
  }
  edges.push([0, 4]);
  return {
    id: 'bridge',
    group: 'Theory examples',
    label: 'Bridge',
    vertices3d: [...tetra, ...mirrored],
    edges,
    layout2d: [
      [-166, 64],
      [-166, -64],
      [-58, 0],
      [-128, 0],
      [58, 0],
      [166, -64],
      [166, 64],
      [128, 0]
    ]
  };
}

export const templatePlaceholders: Template[] = [
  { id: 'cycle-param', group: 'Rings & prisms', label: 'Cycle', parametric: 'cycle', minN: 3, maxN: 128, defaultN: 12, vertices3d: [], edges: [], layout2d: [] },
  { id: 'prism-param', group: 'Rings & prisms', label: 'Prism', parametric: 'prism', minN: 3, maxN: 64, defaultN: 6, vertices3d: [], edges: [], layout2d: [] },
  { id: 'antiprism-param', group: 'Rings & prisms', label: 'Antiprism', parametric: 'antiprism', minN: 3, maxN: 64, defaultN: 4, vertices3d: [], edges: [], layout2d: [] }
];

export const theoryTemplates: Template[] = [
  k2(),
  p3(),
  k4(),
  bridgeTemplate(),
  { ...p3(), id: 'bond-brace-example', label: 'Bond / Brace example', braceEdges: [[1, 2]] }
];

export function instantiateTemplate(template: Template, nextVertexId: number, nextEdgeId: number, center: { x: number; y: number }, occupied?: { vertices: Iterable<number>; edges: Iterable<number> }): { vertices: Array<{ id: number; x: number; y: number; p3?: [number, number, number]; baked3d?: boolean }>; edges: Edge[] } {
  const vertexIds = allocateIds(occupied?.vertices ?? [], template.layout2d.length, nextVertexId);
  const edgeIds = allocateIds(occupied?.edges ?? [], template.edges.length, nextEdgeId);
  const vertices = template.layout2d.map(([x, y], index) => ({
    id: vertexIds[index],
    x: center.x + x,
    y: center.y + y,
    p3: template.vertices3d[index],
    baked3d: template.vertices3d[index] !== undefined
  }));
  const edges: Edge[] = template.edges.map(([a, b], index) => ({
    id: edgeIds[index],
    a: vertexIds[a],
    b: vertexIds[b],
    weight: UNIT_EDGE_WEIGHT,
    kind: template.braceEdges?.some(([u, v]) => (u === a && v === b) || (u === b && v === a)) ? 'brace' : 'bond'
  }));
  return { vertices, edges };
}

export function resolveTemplate(template: Template, n?: number): Template {
  if (template.parametric === 'cycle') return cycleTemplate(n ?? template.defaultN ?? 12);
  if (template.parametric === 'prism') return prismTemplate(n ?? template.defaultN ?? 6);
  if (template.parametric === 'antiprism') return antiprismTemplate(n ?? template.defaultN ?? 4);
  return template;
}
