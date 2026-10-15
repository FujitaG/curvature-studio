import { captureComparison } from '../comparison/persistence';
import { serializeWorkspace } from '../comparison/serialization';
import { useComparison } from '../comparison/store';
import { captureProject } from './workspace';
import { serializeProject } from './format';

/** Emergency export must not load a new chunk or Worker: those may be unavailable.
 * Reuse the validated writers and preserve hidden B even in Single mode.
 * This captures committed editor state, not Undo history or dialog drafts.
 */
export function prepareRecoveryFile(): { filename: string; text: string } {
  if (useComparison.getState().documents.length) {
    return { filename: 'recovery.curvature-workspace.json', text: serializeWorkspace(captureComparison()) };
  }
  return { filename: 'recovery.curvature.json', text: serializeProject(captureProject()) };
}
