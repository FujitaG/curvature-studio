import { assertFiniteDistance, bfsDistances } from './graph';
import { ComponentCache } from './cache';
import { graphComponents } from './components';
import type { OllivierValue, SimpleGraph } from './types';

function gcd(a: number, b: number): number {
  a = Math.abs(Math.trunc(a));
  b = Math.abs(Math.trunc(b));
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

function reduceFraction(num: number, den: number): [number, number] {
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return [num / g, den / g];
}

interface ResidualEdge {
  to: number;
  rev: number;
  cap: number;
  cost: number;
}

function addResidualEdge(graph: ResidualEdge[][], from: number, to: number, cap: number, cost: number): void {
  const fwd: ResidualEdge = { to, rev: graph[to].length, cap, cost };
  const rev: ResidualEdge = { to: from, rev: graph[from].length, cap: 0, cost: -cost };
  graph[from].push(fwd);
  graph[to].push(rev);
}

function minCostTransportation(supplies: number[], demands: number[], costs: number[][]): number {
  const total = supplies.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;

  const sCount = supplies.length;
  const dCount = demands.length;
  const source = sCount + dCount;
  const sink = source + 1;
  const n = sink + 1;
  const residual: ResidualEdge[][] = Array.from({ length: n }, () => []);
  const inf = total;

  for (let i = 0; i < sCount; i += 1) addResidualEdge(residual, source, i, supplies[i], 0);
  for (let i = 0; i < sCount; i += 1) {
    for (let j = 0; j < dCount; j += 1) {
      addResidualEdge(residual, i, sCount + j, inf, costs[i][j]);
    }
  }
  for (let j = 0; j < dCount; j += 1) addResidualEdge(residual, sCount + j, sink, demands[j], 0);

  const potential = new Array<number>(n).fill(0);
  let flow = 0;
  let cost = 0;

  while (flow < total) {
    const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    const prevNode = new Array<number>(n).fill(-1);
    const prevEdge = new Array<number>(n).fill(-1);
    const used = new Array<boolean>(n).fill(false);
    dist[source] = 0;

    for (let iter = 0; iter < n; iter += 1) {
      let v = -1;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < n; i += 1) {
        if (!used[i] && dist[i] < best) {
          best = dist[i];
          v = i;
        }
      }
      if (v === -1 || v === sink) break;
      used[v] = true;
      for (let ei = 0; ei < residual[v].length; ei += 1) {
        const edge = residual[v][ei];
        if (edge.cap <= 0) continue;
        const nd = dist[v] + edge.cost + potential[v] - potential[edge.to];
        if (nd < dist[edge.to]) {
          dist[edge.to] = nd;
          prevNode[edge.to] = v;
          prevEdge[edge.to] = ei;
        }
      }
    }

    if (!Number.isFinite(dist[sink])) {
      throw new Error('Internal error: transportation problem is infeasible');
    }

    for (let i = 0; i < n; i += 1) {
      if (Number.isFinite(dist[i])) potential[i] += dist[i];
    }

    let add = total - flow;
    for (let v = sink; v !== source; v = prevNode[v]) {
      const edge = residual[prevNode[v]][prevEdge[v]];
      add = Math.min(add, edge.cap);
    }
    for (let v = sink; v !== source; v = prevNode[v]) {
      const edge = residual[prevNode[v]][prevEdge[v]];
      edge.cap -= add;
      residual[v][edge.rev].cap += add;
      cost += add * edge.cost;
    }
    flow += add;
  }

  return cost;
}

export function computeOllivierForEdge(graph: SimpleGraph, x: number, y: number, distancesFrom = (source: number) => bfsDistances(graph, source)): OllivierValue {
  const dx = graph.degree[x];
  const dy = graph.degree[y];
  if (dx <= 0 || dy <= 0) {
    throw new Error('Ollivier curvature is defined only on graph edges');
  }

  const lcmDen = 4 * dx * dy;
  const left = new Int32Array(graph.vertexCount);
  const right = new Int32Array(graph.vertexCount);

  left[x] += 2 * dx * dy;
  for (const n of graph.adjacency[x]) left[n] += 2 * dy;
  right[y] += 2 * dx * dy;
  for (const n of graph.adjacency[y]) right[n] += 2 * dx;

  const surplusVertices: number[] = [];
  const deficitVertices: number[] = [];
  const supplies: number[] = [];
  const demands: number[] = [];

  for (let v = 0; v < graph.vertexCount; v += 1) {
    const diff = left[v] - right[v];
    if (diff > 0) {
      surplusVertices.push(v);
      supplies.push(diff);
    } else if (diff < 0) {
      deficitVertices.push(v);
      demands.push(-diff);
    }
  }

  const costs = surplusVertices.map((source) => {
    const distances = distancesFrom(source);
    return deficitVertices.map((target) => assertFiniteDistance(distances, target));
  });
  const transportCost = minCostTransportation(supplies, demands, costs);
  const [wNum, wDen] = reduceFraction(transportCost, lcmDen);
  const [kNum, kDen] = reduceFraction(lcmDen - transportCost, lcmDen);

  return {
    ollivier: (lcmDen - transportCost) / lcmDen,
    ollivierFrac: [kNum, kDen],
    w1Frac: [wNum, wDen]
  };
}

export function computeOllivierCurvatures(graph: SimpleGraph, cache = new ComponentCache<OllivierValue>()): OllivierValue[] {
  const result = new Array<OllivierValue>(graph.edges.length);
  for (const component of graphComponents(graph)) {
    let values = cache.get(component.key);
    if (!values) {
      const distances = new Map<number, Int32Array>();
      const rowLimit = Math.max(1, Math.floor(2 * 1024 * 1024 / (4 * component.graph.vertexCount)));
      const queue = new Int32Array(component.graph.vertexCount);
      const distancesFrom = (source: number) => {
        let row = distances.get(source);
        if (row) distances.delete(source);
        else row = bfsDistances(component.graph, source, queue);
        distances.set(source, row);
        if (distances.size > rowLimit) distances.delete(distances.keys().next().value!);
        return row;
      };
      values = component.graph.edges.map(([a, b]) => computeOllivierForEdge(component.graph, a, b, distancesFrom));
      cache.set(component.key, values);
    }
    component.edgeIndices.forEach((index, local) => { result[index] = values[local]; });
  }
  return result;
}
