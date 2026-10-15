/** Portable document v1 IDs are positive integers strictly below MAX_SAFE_INTEGER. */
export const MAX_ENTITY_ID = Number.MAX_SAFE_INTEGER - 1;
export const validEntityId = (id: number): boolean => Number.isSafeInteger(id) && id > 0 && id <= MAX_ENTITY_ID;
export const followingId = (id: number): number => validEntityId(id) && id < MAX_ENTITY_ID ? id + 1 : 1;

/** Reserve IDs before mutating a document. Existing IDs and references never change. */
export function allocateIds(occupied: Iterable<number>, count: number, preferred = 1): number[] {
  const used = new Set(occupied), ids: number[] = [];
  if (!Number.isSafeInteger(count) || count < 0 || used.size + count > MAX_ENTITY_ID) throw new Error('No safe IDs are available. The graph was not changed.');
  let candidate = validEntityId(preferred) ? preferred : 1;
  while (ids.length < count) {
    if (!used.has(candidate)) { ids.push(candidate); used.add(candidate); }
    candidate = followingId(candidate);
  }
  return ids;
}

/** Keep ordinary IDs increasing, wrapping into unused IDs at the numeric boundary. */
export function nextIdCursor(occupied: Iterable<number>, preferred = 1): number {
  const ids = [...occupied];
  const highest = Math.max(0, ...ids);
  const candidate = Math.max(validEntityId(preferred) ? preferred : 1, highest + 1);
  return allocateIds(ids, 1, candidate)[0];
}
