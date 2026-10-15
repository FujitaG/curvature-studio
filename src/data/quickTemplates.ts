import fixed from './quickTemplates.json';
import { k4, type Template } from './templateCore';

// Generated alongside the full catalog; available immediately on the empty canvas.
export const quickTemplates: Template[] = [...fixed as Template[], k4()];
