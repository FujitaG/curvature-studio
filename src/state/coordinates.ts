import type { Vertex } from './types';

export const COORDINATE_LIMIT = 1_000_000;
export const validCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT;
export const validPosition = (vertex: Pick<Vertex, 'x' | 'y' | 'p3'>): boolean => validCoordinate(vertex.x) && validCoordinate(vertex.y) &&
  (vertex.p3 === undefined || vertex.p3.length === 3 && vertex.p3.every(validCoordinate));
export const POSITION_ERROR = 'Coordinates must stay between -1,000,000 and 1,000,000. The graph was not changed. Move closer to the graph or choose a smaller displacement.';
