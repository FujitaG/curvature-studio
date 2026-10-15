/** RESERVED CONTRACT, not a supported file format or a curvature solver.
 * A cell's finite quotient loses winding and is NOT the infinite bulk graph.
 * Never route these inputs through finite buildSimpleGraph/buildQuotient.
 * Research: notes/periodic-effective-curvature/discussion_record.md (parent project).
 */
export type Dimension = 1 | 2 | 3;
export type Translation = readonly number[];
export interface PeriodicConnection {
  id: number; a: number; b: number; shift: Translation; kind: 'bond' | 'brace';
}
export interface PlannedPeriodicGraph {
  status: 'reserved-not-implemented';
  dimension: Dimension;
  vertexOrbitIds: readonly number[];
  connections: readonly PeriodicConnection[];
  // Physical embedding/lattice units are separate from arbitrary display layouts.
  // Positive Bond conductances require a versioned aggregation/metric policy.
}
export interface PeriodicCopyAddress { edgeOrbitId: number; sourceCell: Translation }
const integer = (n: number) => { if (!Number.isSafeInteger(n)) throw new Error('Periodic translations and IDs require safe integers'); return n === 0 ? 0 : n; };
const vector = (v: Translation, dimension: Dimension) => {
  if (![1, 2, 3].includes(dimension) || v.length !== dimension) throw new Error('Periodic translation dimension mismatch');
  return v.map(integer);
};
const combine = (a: Translation, b: Translation, sign = 1) => a.map((n, i) => integer(n + sign * b[i]));
export function reverseConnection(edge: PeriodicConnection): PeriodicConnection {
  return { ...edge, a: edge.b, b: edge.a, shift: edge.shift.map(n => integer(-n)) };
}
export function periodicConnectionKey(edge: PeriodicConnection, dimension: Dimension): string {
  integer(edge.a); integer(edge.b);
  const shift = vector(edge.shift, dimension);
  if (edge.a === edge.b && shift.every(n => n === 0)) throw new Error('Zero-translation physical self-loops are unsupported');
  const forward = [edge.a, edge.b, ...shift], backward = [edge.b, edge.a, ...shift.map(n => -n)];
  const difference = forward.findIndex((n, i) => n !== backward[i]);
  return JSON.stringify(difference < 0 || forward[difference] < backward[difference] ? forward : backward);
}
export function validatePeriodicConnections(graph: PlannedPeriodicGraph): void {
  vector(Array(graph.dimension).fill(0), graph.dimension);
  const vertices = new Set(graph.vertexOrbitIds.map(integer));
  if (vertices.size !== graph.vertexOrbitIds.length) throw new Error('Duplicate vertex orbit ID');
  const ids = new Set<number>(), keys = new Set<string>();
  for (const edge of graph.connections) {
    integer(edge.id);
    if (ids.has(edge.id) || !vertices.has(edge.a) || !vertices.has(edge.b) || !['bond', 'brace'].includes(edge.kind)) throw new Error('Invalid periodic connection reference');
    const key = periodicConnectionKey(edge, graph.dimension);
    if (keys.has(key)) throw new Error('Duplicate periodic connection: parallel aggregation is not defined');
    ids.add(edge.id); keys.add(key);
  }
}
/** A self-orbit bond has TWO directed incidences, in opposite cells. */
export function directedIncidences(edge: PeriodicConnection): [PeriodicConnection, PeriodicConnection] {
  return [edge, reverseConnection(edge)];
}
/** Preserve the actual drawn connection when reversing its stored orientation. */
export function reverseCopyAddress(edge: PeriodicConnection, sourceCell: Translation, dimension: Dimension): PeriodicCopyAddress {
  return { edgeOrbitId: edge.id, sourceCell: combine(vector(sourceCell, dimension), vector(edge.shift, dimension)) };
}
/** The new representative of v is its OLD cell s_v copy:
 * R' = R + s_a - s_b. Storage need not be gauge-canonical. */
export function changeRepresentatives(edge: PeriodicConnection, sa: Translation, sb: Translation, dimension: Dimension): PeriodicConnection {
  return { ...edge, shift: combine(combine(vector(edge.shift, dimension), vector(sa, dimension)), vector(sb, dimension), -1) };
}

/** Prototype constraint checker only; no merged graph/curvature is produced.
 * Brace offsets satisfy offset(b)=offset(a)+R. Nonzero winding requires an
 * infinite rigid unit, outside this planned FINITE-rigid-unit policy. This is
 * not a claim about local finiteness of every alternative quotient model.
 */
export function finiteRigidOffsets(graph: PlannedPeriodicGraph): Map<number, { root: number; offset: number[] }> {
  validatePeriodicConnections(graph);
  const adjacent = new Map(graph.vertexOrbitIds.map(id => [id, [] as PeriodicConnection[]]));
  for (const edge of graph.connections.filter(e => e.kind === 'brace')) {
    for (const directed of directedIncidences(edge)) adjacent.get(directed.a)!.push(directed);
  }
  const assigned = new Map<number, { root: number; offset: number[] }>();
  for (const root of graph.vertexOrbitIds) {
    if (assigned.has(root)) continue;
    assigned.set(root, { root, offset: Array(graph.dimension).fill(0) });
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const current = assigned.get(queue[i])!;
      for (const edge of adjacent.get(queue[i])!) {
        const offset = combine(current.offset, edge.shift), prior = assigned.get(edge.b);
        if (prior && prior.offset.some((n, k) => n !== offset[k])) throw new Error('Nonzero Brace winding is unsupported by the finite-rigid-unit policy');
        if (!prior) { assigned.set(edge.b, { root, offset }); queue.push(edge.b); }
      }
    }
  }
  return assigned;
}
/** Unlike finite endpoint deduplication, a nonzero residual self-orbit bond survives. */
export function isPeriodicIntraUnit(edge: PeriodicConnection, offsets: ReturnType<typeof finiteRigidOffsets>): boolean {
  const a = offsets.get(edge.a), b = offsets.get(edge.b);
  if (!a || !b) throw new Error('Missing rigid offset');
  return a.root === b.root && combine(combine(edge.shift, a.offset), b.offset, -1).every(n => n === 0);
}
export function createPeriodicOperator(_graph: PlannedPeriodicGraph): never {
  // TODO(periodic): validate connected lift/lattice rank; translation-aware
  // rigid quotient; complex Bloch ROW operators with conjugate norms, or an
  // independently validated sparse interior patch. Never use real SimpleGraph
  // for Bloch fibers. Quadrature/tail/rounding errors need separate bounds.
  throw new Error('Periodic operator construction is reserved but not implemented');
}
