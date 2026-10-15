import { parseWorkspace, type WorkspaceJson } from '../comparison/format';
import { normalizeUnitEdge, type UnitEdge } from '../graph/edge';
import type { SessionJson } from '../state/interchange';
import { parseProjectJson, projectToJson, type ProjectJson } from './format';

/** Internal, nonpersistent adapter — NOT a public v2 format or live-store migration.
 * Graph identity owns no coordinates, camera, color, or paper units. A future
 * multi-layout/figure editor can use this boundary without redefining topology.
 */
export interface ProjectModel {
  graph: { vertices: { id: number }[]; edges: UnitEdge[] };
  layout2d: { id: number; x: number; y: number }[];
  layout3d: { id: number; p3?: [number, number, number]; baked3d?: boolean }[];
  presentation: Omit<SessionJson, 'doc' | 'format' | 'version'>;
  metadata: ProjectJson['metadata'];
  calculation: ProjectJson['calculation'];
  resultsDisplay: ProjectJson['resultsDisplay'];
  figure?: ProjectJson['figure'];
  extensions: ProjectJson['extensions'];
}

/** Input is a validated canonical v1 project. Legacy inputs are wrapped by the
 * existing parser first (once), so migration never invents a second project ID.
 */
export function projectToModel(input: ProjectJson): ProjectModel {
  if (input?.format !== 'curvature-studio/project') throw new Error('Wrap a legacy document/session as a project before converting its model');
  const p = projectToJson(parseProjectJson(input, 'Imported project', false));
  const { doc, format: _format, version: _version, ...presentation } = p.session;
  return structuredClone({
    graph: { vertices: doc.vertices.map(({ id }) => ({ id })), edges: doc.edges.map(normalizeUnitEdge) },
    layout2d: doc.vertices.map(({ id, x, y }) => ({ id, x, y })),
    // Absence is meaningful: do not materialize the viewer's fallback 3D points.
    layout3d: doc.vertices.filter(v => v.p3 !== undefined || v.baked3d !== undefined)
      .map(({ id, p3, baked3d }) => ({ id, ...(p3 === undefined ? {} : { p3 }), ...(baked3d === undefined ? {} : { baked3d }) })),
    presentation, metadata: p.metadata, calculation: p.calculation,
    resultsDisplay: p.resultsDisplay, ...(p.figure === undefined ? {} : { figure: p.figure }), extensions: p.extensions
  });
}

export function modelToProject(model: ProjectModel): ProjectJson {
  const ids = new Set(model.graph.vertices.map(v => v.id));
  const index = <T extends { id: number }>(items: T[], label: string) => {
    const map = new Map<number, T>();
    for (const item of items) {
      if (!ids.has(item.id) || map.has(item.id)) throw new Error(`Invalid ${label} reference: ${item.id}`);
      map.set(item.id, item);
    }
    return map;
  };
  const points = index(model.layout2d, '2D layout'), spatial = index(model.layout3d, '3D layout');
  if (points.size !== ids.size) throw new Error('Every vertex needs a 2D layout position');
  const vertices = model.graph.vertices.map(({ id }) => ({ id, x: points.get(id)!.x, y: points.get(id)!.y,
    ...(spatial.get(id)?.p3 === undefined ? {} : { p3: spatial.get(id)!.p3 }),
    ...(spatial.get(id)?.baked3d === undefined ? {} : { baked3d: spatial.get(id)!.baked3d }) }));
  return projectToJson(parseProjectJson({
    format: 'curvature-studio/project', version: 1,
    metadata: model.metadata, calculation: model.calculation, resultsDisplay: model.resultsDisplay,
    extensions: model.extensions, ...(model.figure === undefined ? {} : { figure: model.figure }),
    session: { ...model.presentation, format: 'curvature-studio/session', version: 2,
      doc: { format: 'curvature-studio/doc', version: 1, vertices, edges: model.graph.edges } }
  }, 'Imported project', false));
}

export interface WorkspaceModel {
  documents: (Omit<WorkspaceJson['documents'][number], 'project'> & { project: ProjectModel })[];
  /** Shared comparison controls stay distinct from each document's native style. */
  presentation: Omit<WorkspaceJson, 'format' | 'version' | 'documents'>;
}
export function workspaceToModel(input: WorkspaceJson): WorkspaceModel {
  // Unlike the live recovery reader, this internal adapter must not repair data.
  for (const document of input?.documents ?? []) {
    if (document.project?.format !== 'curvature-studio/project') throw new Error('Wrap each legacy document/session as a project before converting its workspace model');
    parseProjectJson(document.project, 'Imported project', false);
  }
  const { documents, format: _format, version: _version, ...presentation } = parseWorkspace(input);
  return { presentation: structuredClone(presentation), documents: documents.map(({ project, ...rest }) => ({ ...rest, project: projectToModel(project) })) };
}
export function modelToWorkspace(model: WorkspaceModel): WorkspaceJson {
  return parseWorkspace({ ...model.presentation, format: 'curvature-studio/workspace', version: 1,
    documents: model.documents.map(({ project, ...rest }) => ({ ...rest, project: modelToProject(project) })) });
}
