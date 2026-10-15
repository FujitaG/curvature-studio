import type { UnitEdgeInput } from '../graph/edge';
export type { EdgeKind } from '../graph/edge';

export interface MathVertex { id: number }

/** Weight is preserved at the math boundary; legacy omissions are unit values. */
export interface MathEdge extends UnitEdgeInput {}

/** Unit quotient only. TODO(weighted-graphs): use a separate weighted quotient
 * with conductances AND vertex strengths; never reinterpret degree as strength. */
export interface SimpleGraph {
  vertexCount: number;
  edges: Array<[number, number]>;
  adjacency: number[][];
  degree: Int32Array;
}

export interface Rational {
  num: number;
  den: number;
}

export interface OllivierValue {
  ollivier: number;
  ollivierFrac: [number, number];
  w1Frac: [number, number];
}

export interface EffectiveValue {
  vInf: number;
  kEff: number;
  converged: boolean;
  iterations: number;
}

export interface QuotientValue extends OllivierValue, EffectiveValue {}

export interface QuotientResult {
  unitOf: Map<number, number>;
  quotientEdges: Array<[number, number]>;
  bondMap: Map<number, number | 'intra'>;
  graph: SimpleGraph;
}

export interface MetricResult {
  key: string;
  unitOf: Map<number, number>;
  quotientEdges: Array<[number, number]>;
  values: QuotientValue[];
  bondMap: Map<number, number | 'intra'>;
}
