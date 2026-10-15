import { POLYHEDRON_EXAMPLE_JSON, POLYHEDRON_EXAMPLE_TXT } from '../import/examples';
import { downloadText } from '../state/persistence';
import { Dialog } from './Dialog';

export function PolyhedronImportGuide({ onClose, onChooseFile }: { onClose: () => void; onChooseFile: () => void }): JSX.Element {
  return <Dialog className="figure-dialog polyhedron-guide" title="Polyhedron file format" onClose={onClose}>
    <p>Prepare a UTF-8 <strong>.json</strong> file using the example below. Import adds it to your template library and places it using the selected Add / Replace mode. Use Open project for a saved Curvature Studio project.</p>
    <div className="figure-actions">
      <button className="button" onClick={() => downloadText('tetrahedron.polyhedron.json', POLYHEDRON_EXAMPLE_JSON, 'application/json')}>Download example JSON</button>
      <button className="button" onClick={onChooseFile}>Choose polyhedron file…</button>
    </div>
    <pre tabIndex={0} aria-label="Polyhedron JSON example"><code>{POLYHEDRON_EXAMPLE_JSON}</code></pre>
    <dl>
      <dt>format / version / name</dt><dd>Use the format and version above; change name to your shape’s name.</dd>
      <dt>vertices</dt><dd>Each entry is a 3D coordinate [x, y, z]. Use finite JSON numbers. Indices start at <strong>0</strong>: the first vertex is 0, the second is 1. A 2D layout is generated automatically.</dd>
      <dt>faces</dt><dd>List vertex indices in boundary order. The last vertex connects back to the first, so do <strong>not</strong> repeat the first index at the end. Each face needs at least 3 distinct indices. Shared edges between faces are merged.</dd>
      <dt>edges (alternative)</dt><dd>You may replace faces with explicit pairs, for example <code>"edges": [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]</code>. If both edges and faces are supplied, <strong>only edges defines the graph</strong>; faces helps with layout.</dd>
    </dl>
    <p>All imported edges become Bonds. Faces describe boundaries for layout; they do not create filled surfaces or change curvature directly.</p>
    <h3>Limits and common mistakes</h3>
    <ul>
      <li>1–1,000 vertices, at most 3,000 edges, file size at most 8 MiB. Coordinate magnitudes must not exceed 1,000,000.</li>
      <li>Supply edges or faces. All indices must refer to an existing vertex. No self-loops or duplicate explicit edges (including reversed pairs).</li>
      <li>JSON requires quoted property names, with no comments or trailing commas. Coordinates cannot be expressions such as “sqrt(2)”; write their numeric values.</li>
    </ul>
    <a href={`${import.meta.env.BASE_URL}schemas/polyhedron-v1.schema.json`} download="polyhedron-v1.schema.json">Download JSON Schema</a>
    <details><summary>TXT format (supported subset)</summary>
      <p>McCooey-style text uses consecutive V0, V1, … coordinates and a Faces: section. Constants C0, C1, … must be defined before use. Supported arithmetic: +, −, *, /, parentheses and sqrt(...). This is a limited text parser, not a general mesh importer.</p>
      <button className="button" onClick={() => downloadText('tetrahedron.txt', POLYHEDRON_EXAMPLE_TXT, 'text/plain')}>Download example TXT</button>
      <pre tabIndex={0} aria-label="Polyhedron TXT example"><code>{POLYHEDRON_EXAMPLE_TXT}</code></pre>
    </details>
    <p className="muted">OBJ, STL, PLY and OFF files are not supported. Convert their vertices and edges / face boundaries to the JSON format above first.</p>
  </Dialog>;
}
