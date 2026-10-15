import { serializeProject } from '../project/format';
import { parseWorkspace, type WorkspaceJson } from './format';

/** Writer and reader must agree: never label an unopenable pair as saved. */
export function serializeWorkspace(value: WorkspaceJson): string {
  // Strict writer validation rejects invalid cameras instead of repairing them.
  for (const document of value.documents) serializeProject(document.project);
  return JSON.stringify(parseWorkspace(value));
}
