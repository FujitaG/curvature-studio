interface Cell {
  x: number; y: number; z: number; half: number;
  mass: number; mx: number; my: number; mz: number;
  children?: Cell[];
  points?: number[];
  coincident: boolean;
}

/** Barnes–Hut for display layout only; curvature never uses this approximation. */
export function repulsionOctree(positions: Float64Array, displacement: Float64Array, theta = 0.45): void {
  const count = positions.length / 3;
  if (!count) return;
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let d = 0; d < 3; d += 1) {
    low[d] = Math.min(low[d], positions[i + d]); high[d] = Math.max(high[d], positions[i + d]);
  }
  function build(points: number[], x: number, y: number, z: number, half: number, depth: number): Cell {
    let sx = 0, sy = 0, sz = 0;
    const first = points[0];
    let coincident = true;
    for (const i of points) {
      sx += positions[i]; sy += positions[i + 1]; sz += positions[i + 2];
      if (positions[i] !== positions[first] || positions[i + 1] !== positions[first + 1] || positions[i + 2] !== positions[first + 2]) coincident = false;
    }
    const cell: Cell = { x, y, z, half, mass: points.length, mx: sx / points.length, my: sy / points.length, mz: sz / points.length, coincident };
    if (coincident) { cell.mx = positions[first]; cell.my = positions[first + 1]; cell.mz = positions[first + 2]; }
    if (points.length <= 8 || depth >= 24 || coincident) { cell.points = points; return cell; }
    const groups: number[][] = Array.from({ length: 8 }, () => []);
    for (const i of points) groups[(positions[i] >= x ? 1 : 0) | (positions[i + 1] >= y ? 2 : 0) | (positions[i + 2] >= z ? 4 : 0)].push(i);
    const childHalf = half / 2;
    cell.children = groups.flatMap((group, octant) => group.length ? [build(group,
      x + (octant & 1 ? childHalf : -childHalf), y + (octant & 2 ? childHalf : -childHalf), z + (octant & 4 ? childHalf : -childHalf), childHalf, depth + 1)] : []);
    return cell;
  }
  const root = build(Array.from({ length: count }, (_, i) => i * 3), (low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2,
    Math.max(1e-6, ...high.map((v, d) => (v - low[d]) / 2)) * 1.000001, 0);
  const thetaSquared = theta * theta;
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i], py = positions[i + 1], pz = positions[i + 2];
    const visit = (cell: Cell): void => {
      const dx = px - cell.mx, dy = py - cell.my, dz = pz - cell.mz;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const contains = Math.abs(px - cell.x) <= cell.half && Math.abs(py - cell.y) <= cell.half && Math.abs(pz - cell.z) <= cell.half;
      if (cell.coincident || !contains && 4 * cell.half * cell.half < thetaSquared * distanceSquared) {
        const factor = cell.mass / Math.max(1e-8, distanceSquared);
        displacement[i] += dx * factor; displacement[i + 1] += dy * factor; displacement[i + 2] += dz * factor;
      } else if (cell.children) {
        for (const child of cell.children) visit(child);
      } else {
        for (const other of cell.points!) {
          if (other === i) continue;
          const x = px - positions[other], y = py - positions[other + 1], z = pz - positions[other + 2];
          const factor = 1 / Math.max(1e-8, x * x + y * y + z * z);
          displacement[i] += x * factor; displacement[i + 1] += y * factor; displacement[i + 2] += z * factor;
        }
      }
    };
    visit(root);
  }
}
