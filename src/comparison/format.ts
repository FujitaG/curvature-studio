import { parseProjectJson, projectToJson, serializeProject, type ProjectJson, type JsonValue } from '../project/format';
import { DEFAULT_STUDIO_STYLE, normalizeStudioStyle, normalizeSavedGradients, type SharedStyle, type SavedGradient } from '../state/style';
import type { MetricMode, ProjectionMode, ViewMode } from '../state/types';
export const MAX_WORKSPACE_BYTES = 20 * 1024 * 1024;
export interface WorkspaceJson {
    format: 'curvature-studio/workspace';
    version: 1;
    documents: {
        id: string;
        side: 'A' | 'B';
        project: ProjectJson;
        viewport2d: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        camera2dMode: 'fit' | 'manual';
    }[];
    mode: 'single' | 'compare';
    activeId: string;
    ratio: number;
    linked: boolean;
    distribution: 'share' | 'count';
    metric: MetricMode;
    view: ViewMode;
    projection: ProjectionMode;
    colors: SharedStyle;
    custom: SavedGradient[];
    extensions: Record<string, JsonValue>;
}
export function parseWorkspace(input: unknown): WorkspaceJson {
    const r = input as WorkspaceJson;
    if (!r || r.format !== 'curvature-studio/workspace' || r.version !== 1)
        throw new Error('Unsupported comparison workspace format or version');
    if (!Array.isArray(r.documents) || r.documents.length !== 2)
        throw new Error('A comparison must contain two structures');
    const ids = new Set<string>();
    const documents = r.documents.map((d, i) => {
        if (!d || typeof d.id !== 'string' || !d.id || d.id.length > 128 || ids.has(d.id) || d.side !== (i ? 'B' : 'A'))
            throw new Error('Invalid or duplicate comparison document reference');
        ids.add(d.id);
        let project: ProjectJson;
        try { project = projectToJson(parseProjectJson(d.project)); serializeProject(project); }
        catch (error) { throw new Error(`Structure ${d.side}: ${error instanceof Error ? error.message : 'Invalid project'}`); }
        const viewport2d = d.viewport2d;
        if (!viewport2d || !['x', 'y', 'width', 'height'].every(key => { const v = viewport2d[key as keyof typeof viewport2d]; return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7; }) || !(viewport2d.width > 0 && viewport2d.height > 0) || !['fit', 'manual'].includes(d.camera2dMode))
            throw new Error('Invalid comparison camera viewport');
        return { id: d.id, side: d.side, project, viewport2d: { ...viewport2d }, camera2dMode: d.camera2dMode };
    });
    if (!ids.has(r.activeId) || !['single', 'compare'].includes(r.mode) || !Number.isFinite(r.ratio) || r.ratio < 25 || r.ratio > 75 || typeof r.linked !== 'boolean' || !['share', 'count'].includes(r.distribution) || !['keff', 'ollivier'].includes(r.metric) || !['2d', '3d'].includes(r.view) || !['perspective', 'orthographic'].includes(r.projection))
        throw new Error('Invalid comparison view settings');
    const colors = normalizeStudioStyle({ ...DEFAULT_STUDIO_STYLE, shared: r.colors }).shared;
    if (!Array.isArray(r.custom))
        throw new Error('Invalid comparison gradients');
    const custom = normalizeSavedGradients(r.custom);
    const extensions = parseProjectJson({ ...documents[0].project, extensions: r.extensions ?? {} }).extensions;
    const result: WorkspaceJson = { format: r.format, version: 1, documents, mode: r.mode, activeId: r.activeId, ratio: r.ratio, linked: r.linked, distribution: r.distribution, metric: r.metric, view: r.view, projection: r.projection, colors, custom, extensions };
    if (new Blob([JSON.stringify(result)]).size > MAX_WORKSPACE_BYTES)
        throw new Error('Comparison exceeds 20 MiB. Export each structure separately.');
    return result;
}
