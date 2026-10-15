import { repulsionOctree } from './octree';

export interface LayoutVertex {
  id: number;
  x: number;
  y: number;
  p3?: [number, number, number];
  baked3d?: boolean;
}

export interface LayoutInput {
  vertices: LayoutVertex[];
  edges: Array<{ a: number; b: number }>;
  relaxAll: boolean;
}

export type LayoutPosition = { id: number; p3: [number, number, number] };
export type LayoutMessage =
  | { type: 'progress'; progress: number }
  | { type: 'result'; positions: LayoutPosition[] }
  | { type: 'error'; message: string };

/** Exact small layouts; Barnes–Hut repulsion for large displays. */
export function createRelaxation(input: LayoutInput) {
  const vertices = [...input.vertices].sort((a, b) => a.id - b.id);
  const index = new Map(vertices.map((v, i) => [v.id, i]));
  const positions = new Float64Array(vertices.length * 3);
  const displacement = new Float64Array(positions.length);
  const pinned = vertices.map((v) => !input.relaxAll && !!v.baked3d);
  vertices.forEach((v, i) => {
    const jitter = 0.01 * (((v.id * 2654435761) % 1000) - 500) / 500;
    positions.set(v.p3 ?? [v.x / 64, -v.y / 64, jitter], i * 3);
  });
  const edges = input.edges.flatMap((e) => {
    const a = index.get(e.a), b = index.get(e.b);
    return a === undefined || b === undefined ? [] : [[a * 3, b * 3]];
  });
  let iteration = vertices.length < 2 || pinned.every(Boolean) ? 300 : 0;

  const step = () => {
    displacement.fill(0);
    if (vertices.length >= 400) repulsionOctree(positions, displacement);
    else for (let a = 0; a < positions.length; a += 3) {
      for (let b = a + 3; b < positions.length; b += 3) {
        const dx = positions[a] - positions[b];
        const dy = positions[a + 1] - positions[b + 1];
        const dz = positions[a + 2] - positions[b + 2];
        const distance = Math.max(1e-4, Math.hypot(dx, dy, dz));
        const force = 1 / distance;
        const ux = (dx / distance) * force, uy = (dy / distance) * force, uz = (dz / distance) * force;
        displacement[a] += ux; displacement[a + 1] += uy; displacement[a + 2] += uz;
        displacement[b] -= ux; displacement[b + 1] -= uy; displacement[b + 2] -= uz;
      }
    }
    for (const [a, b] of edges) {
      const dx = positions[a] - positions[b];
      const dy = positions[a + 1] - positions[b + 1];
      const dz = positions[a + 2] - positions[b + 2];
      const distance = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const force = distance * distance;
      const ux = (dx / distance) * force, uy = (dy / distance) * force, uz = (dz / distance) * force;
      displacement[a] -= ux; displacement[a + 1] -= uy; displacement[a + 2] -= uz;
      displacement[b] += ux; displacement[b + 1] += uy; displacement[b + 2] += uz;
    }
    const temperature = 0.08 * (1 - iteration / 300);
    vertices.forEach((_, i) => {
      if (pinned[i]) return;
      const a = i * 3;
      const dx = displacement[a], dy = displacement[a + 1], dz = displacement[a + 2];
      const length = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const amount = Math.min(length, temperature);
      positions[a] += (dx / length) * amount;
      positions[a + 1] += (dy / length) * amount;
      positions[a + 2] += (dz / length) * amount;
    });
    iteration += 1;
  };
  return {
    get done() { return iteration === 300; },
    get progress() { return iteration / 300; },
    stepUntil(deadline: number) {
      while (iteration < 300 && performance.now() < deadline) step();
    },
    result(): LayoutPosition[] {
      return vertices.map((v, i) => ({ id: v.id, p3: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]] }));
    }
  };
}
