/** File decoding shared by every import entry point. Never changes live state. */
export function parseJsonText(text: string): Record<string, unknown> {
  const source = text.replace(/^\uFEFF/, '');
  if (!source.trim()) throw new Error('This file is empty. Choose a file containing your saved data.');
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) {
    const position = error instanceof Error ? /position (\d+)/.exec(error.message) : null;
    const offset = position ? Number(position[1]) : null;
    const lines = offset === null ? null : source.slice(0, offset).split('\n');
    const where = lines ? ` near line ${lines.length}, column ${lines.at(-1)!.length + 1}` : '';
    throw new Error(`This is not valid JSON${where}. Check for missing brackets, quotes, or extra commas, then select the corrected file.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The file must contain a JSON object, not null, a list, or a single value.');
  return value as Record<string, unknown>;
}

type ImportTarget = 'project' | 'workspace' | 'doc' | 'session' | 'style' | 'polyhedron';
const routes: Record<string, string> = {
  project: 'Open project', workspace: 'Open project (to open both structures)',
  doc: 'Open project or Menu → Compatibility formats → Import JSON',
  session: 'Open project or Menu → Compatibility formats → Open session',
  style: 'Menu → Compatibility formats → Import style',
  polyhedron: 'Templates → Import polyhedron'
};
export function checkImportTarget(input: Record<string, unknown>, target: ImportTarget): void {
  const allowed = target === 'workspace' ? ['workspace','project','session','doc'] : target === 'project' ? ['project','session','doc'] : [target];
  if (allowed.some(kind => input.format === `curvature-studio/${kind}`)) return;
  const kind = typeof input.format === 'string' ? input.format.replace(/^curvature-studio\//, '') : '';
  if (Object.hasOwn(routes, kind)) throw new Error(`This is a ${kind === 'doc' ? 'document' : kind} file. Use ${routes[kind]} to open it.`);
  throw new Error(`This file is not a supported Curvature Studio ${target === 'workspace' ? 'project or comparison' : target === 'doc' ? 'document' : target} file. Choose the matching JSON file${target === 'polyhedron' ? ' or see File format & examples in Templates' : ''}.`);
}
