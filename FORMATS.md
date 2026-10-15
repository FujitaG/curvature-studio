# Curvature Studio file formats

JSON readers ignore unknown object fields, except `calculation`, which rejects unknown
parameters, and project `extensions`, which is preserved across reads and writes.
Writers emit the fields documented here. A
missing or unsupported `format` or `version` produces a clear error toast and no part of
the file is applied. JSON files are UTF-8. Numeric values must be finite JSON numbers.
The document hard limits are 1,000 vertices and 3,000 edges. Single projects are limited to 8 MiB; comparison workspaces to 20 MiB, with an 8 MiB limit per embedded project. Graph coordinates and viewport/histogram components have absolute
magnitude at most 1,000,000. Camera positions/translations/bounds allow magnitude up to
1e12; their limits are separate from graph coordinates. JSON version tags must
be numbers, not numeric strings. A leading UTF-8 BOM is accepted.

## Comparison workspace JSON

Format `curvature-studio/workspace`, numeric version `1`.
Filename `comparison.curvature-workspace.json`. Schema: [workspace-v1.schema.json](public/schemas/workspace-v1.schema.json).
Example: [cube-comparison.curvature-workspace.json](examples/cube-comparison.curvature-workspace.json).

- `documents`: exactly two entries, ordered A then B. Each has a unique nonempty `id` (at most 128 characters), `side`, a complete project-v1 `project`, `viewport2d` (`x/y/width/height` in local CSS pixels), and `camera2dMode` (`fit` or `manual`). The viewport is the unobscured rectangle used to preserve the camera centre across pane size changes. Its components must be finite, magnitude below 10 million, with positive width/height.
- `mode`: `single` or `compare`; `activeId` must reference one of the documents. Both documents are always serialized, including in single mode.
- `ratio`: A's split percentage, 25–75. `linked`: rotation/zoom linkage. `distribution`: `share` or `count`.
- `metric`: `keff` or `ollivier`; `view`: `2d` or `3d`; `projection`: `perspective` or `orthographic`.
- `colors`: shared comparison style (same shape as `session.style.shared`); `custom`: saved gradient definitions. Comparison overlays these on the two documents; their native styles remain in the embedded projects. Single view restores each native style.
- `extensions`: namespaced optional JSON data, retained across reads/writes. Same JSON/depth validation as project extensions.

The reader validates both projects and references before publishing either document. Unsupported calculation definitions are rejected by the project reader. There are no stored calculated results, graph matching assumptions, or changes to mathematical parameters. Transient selection and Undo histories are not serialized. Histories survive switching between comparison and single view within the same page.

Downloads use compact UTF-8 JSON. Serialization runs in a Worker, checks each embedded project's 8 MiB limit, then checks the final workspace's 20 MiB limit. Never silently drop extensions or the hidden document to fit. Each graph retains the 1,000-vertex/3,000-edge limit.

Browser autosave for **both single projects and comparisons** uses IndexedDB database `curvature-studio-workspaces`, database version **2**, object store `workspaces`, key `current`. The internal envelope is `{version: 2, kind: "project" | "comparison", generation, revision, raw}`. This is not a new portable file format. A read/write transaction compares kind/generation/revision and commits ownership and complete content together. Jobs capture their expected revision and lifecycle token before asynchronous serialization. BroadcastChannel is advisory, not the correctness mechanism. A stale generation cannot be restored by ordinary Resume.

Migration validates the old v1 comparison or, if absent, legacy localStorage project/document. `migrationComplete` is committed together with `current`; missing or corrupt migrated data never silently falls back to legacy LS. Legacy bytes remain migration/recovery material, not another authority. Later legacy writes are detected by length + SHA-256 and offered for explicit recovery. HTTPS or localhost is required. An explicit **Replace unreadable autosave…** action compares the observed unreadable record, archives its bytes under `recovery-<uuid>`, and writes a new generation. Normal Resume cannot perform this replacement.

**End comparison…** commits the kept project and ends comparison in the same transaction, before removing the other live store. Single view still retains both documents. The optional discarded-project download is memory-only and expires on replacement, new comparison, or reload. The kept project's extensions are preserved; comparison-level extensions remain available in a downloaded comparison but are not merged into the kept project. End comparison has no workspace Undo; retained graph-edit history survives in memory.

Pending single-project edits may write an emergency localStorage copy under `curvature-studio:recovery-journal:v2:<uuid>` on pagehide. Immutable snapshot keys prevent deletion of an inspected copy from erasing another tab's later write. Copies are recovery aids, never an automatic authority. The cooperative budget is four copies / 2 MiB total (concurrent tabs can race the budget check; browser quota remains the hard limit). Other pages' unsaved copies are not evicted. Matching committed copies can be removed; otherwise use **Open recovery…**, **Download recovery data**, or confirmed **Delete recovery copy…**. Hide notice does not delete data. Large projects, quota errors, and abrupt termination may prevent this emergency copy. Comparison edits do not use this journal. Only a completed IDB transaction produces Saved status.

`Open project` also accepts this workspace format. The work being replaced is retained for **Download previous work**, in memory until the next comparison import or page reload. Saving/opening a single project is independent of the workspace's common comparison palette. Normal image/results exports target the active document; combined comparison figure export is not implemented.

## Project JSON (recommended for saving work)

`format`: `curvature-studio/project`
`version`: `1`
Filename: `<project-name>.curvature.json`
Editor schema: [`public/schemas/project-v1.schema.json`](public/schemas/project-v1.schema.json)
Example: [`examples/cube-study.curvature.json`](examples/cube-study.curvature.json)

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format`, `version` | string, integer | yes | Tag and numeric version above. |
| `metadata.id` | string | yes | Stable project ID, nonblank, at most 128 characters. |
| `metadata.title` | string | yes | Nonblank title, at most 120 characters. |
| `metadata.notes` | string | yes | Plain text, at most 10,000 characters. |
| `metadata.createdAt`, `metadata.updatedAt` | string | yes | UTC ISO timestamps ending in Z; updatedAt is not earlier than createdAt. |
| `calculation` | object | yes | Engine and exact supported parameters below. |
| `session` | object | yes | Complete session v2; readers also accept legacy session v1. |
| `resultsDisplay.precision` | integer | no | 2–10 decimal places; defaults to 6 when the object is absent. Controls display only. |
| `extensions` | object | no | Arbitrary JSON values under namespaced keys; preserved exactly as JSON data. Defaults to `{}`. Maximum nesting depth 30. |

The calculation descriptor is currently:

```json
{"engine":"curvature-studio/math@1","graphModel":"undirected-unweighted-rigid-quotient","laziness":0.5,"tailTolerance":1e-10,"maxIterations":200000}
```

Unsupported versions, engine IDs, graph models or parameter values reject the whole file.
unknown keys inside `calculation` also reject the file; they cannot be
silently ignored as a new mathematical input. Put optional annotations in `extensions`.
The engine tag must change when the calculation's semantics or numerical algorithm changes.
Display-only changes do not require an engine change. Future optional metadata may be added
without a format bump; incompatible or meaning-changing changes require an explicit version
and migration. Extensions are never interpreted as new mathematical inputs by this reader.

**Open project** accepts project v1, session v1/v2 and document v1, identified by their
`format` tag rather than their filename. Legacy inputs gain fresh project metadata; a bare
document gains default display settings and is fitted to the viewport. Full validation occurs
before changes are applied. `Undo open` holds one previous complete snapshot for recovery;
normal Undo continues to operate on graph history. Neither history nor transient selection,
current tool, open auxiliary panels, or the template library is part of the file.

an invalid saved camera or projection is reset with a notice while the
valid graph and metadata are loaded. A 2D camera is fitted to the graph; an invalid 3D
camera is discarded and initialized by the view. All other validation remains strict.
These notices are runtime-only and are never written into project/session files.

Downloads and autosave share `serializeProject`: strict reader validation without camera
repair, canonical field serialization, compact JSON, and a final UTF-8 size check (8 MiB inclusive). Failure preserves
the previous autosave and all in-memory extensions and does not claim success. There is
no guarantee that a near-limit imported project can still be saved after adding data or
materializing omitted defaults such as unit edge weights. Extensions are preserved;
unsupported edge weights are rejected rather than replaced during serialization.

Calculated values are not stored in project files. Opening a project requests current
results; a matching completed in-memory calculation may be reused within the page session.
Component caches, shortest-path caches and rendering batches are runtime-only and are
never serialized or accepted as trusted calculation state from a project file.
Browser autosave uses the same IndexedDB v2 current envelope as comparisons (see above). Storage failure does not prevent in-memory editing or downloading, but there is no localStorage-authority fallback when IDB is unavailable. Download files for durable portable backups; browser transaction completion is not a guarantee against device failure or storage eviction.

## Results JSON (analysis archive, output only)

`format`: `curvature-studio/results`
`version`: `1`
Filename: `<project-name>.results.json`

| Field | Meaning |
| --- | --- |
| `exportedAt` | UTC timestamp of export. |
| `project` | Project metadata at export; the results document does not serve as a saved workspace. |
| `calculation` | Engine and settings used, as in the project descriptor. |
| `doc` | Complete document v1, including coordinates and 3D pin flags. |
| `inputKey` | Canonical input identity: the full current calculation descriptor, sorted vertex IDs and edge records with ID, ordered endpoints, kind and normalized unit weight. Coordinates are excluded. This is an identity string, not a cryptographic digest. |
| `applicationVersion`, `sampleUnit` | App version (separate from format/engine versions); currently `quotient-bond`. |
| `summary` | `quotientBonds` and `notConverged` counts; each quotient bond is counted once. |
| `units[]` | `{vertexId, unitId}` for every input vertex, including isolated vertices. |
| `quotientBonds[]` | `{index,a,b,ollivier,ollivierFrac,w1Frac,vInf,kEff,converged,iterations,evidence}`; `a,b` are unit IDs. Fractions are `[numerator,denominator]`. |
| `edges[]` | `{id,a,b,kind,quotient,status}`; endpoints are original vertex IDs. `quotient` is an index, `"intra"`, or `null` for a brace. Status is `complete`, `not-converged`, `brace` or `intra`. |

Each quotient bond now has `evidence.ollivier` (`exact-rational`, fraction fields,
rounded decimal) and `evidence.effective` (`truncated-sum`, exact-arithmetic bound
directions V lower / κ upper, `unverified-floating-point`, `certified:false`,
`termination`, variance-tail tolerance and iterations). Evidence describes the
existing calculation; it does not add a tail or certify numeric rounding.

Only complete, current calculations can be exported. `converged=false` denotes a finite
estimate stopped at the iteration cap. A completed result is not necessarily converged.
No NaN/Infinity sentinels are emitted. The app does not import results archives as trusted
calculation state. Open the associated project file, or extract its document input, to
recompute a result.

## Workspace lifecycle and browser preferences

The portable formats remain project v1, session v2 and style v2. Calculation engine tags,
CSV/JSON field names, identifiers and numerical exports are independent of UI language.
Opening a project never translates its user-authored title or notes.

**New project** creates a new ID, title, empty notes/extensions, timestamps and precision 6.
It retains user display preferences and the active view/metric, and resets cameras for the
empty graph. **Undo new project** restores the complete prior workspace in the current
page session; normal Undo does the same once the new document's edit history is empty.
**Clear canvas** and template **Replace canvas** retain project metadata and use document
Undo/Redo. Undo history and the prior-project recovery snapshot are not portable or
retained across reloads.

document Undo/Redo stores changed vertex/edge records. History retains
at most 200 operations and 40,000 changed records; large replacements can therefore
shorten the available history. Coordinates, optional 3D positions and pin flags are
restored together. The separate whole-workspace recovery snapshot remains unchanged.
3D layout at 400 or more vertices approximates repulsion using Barnes–Hut. This affects
display coordinates only, which are still saved in the same fields at full precision;
the curvature calculation descriptor and all portable format versions remain unchanged.

navigation may temporarily reduce the screen pixel ratio, small-object
mesh detail and non-focused labels. These are runtime rendering choices, not stored
project settings. Full geometry is used for picking and PNG export, and both PNG/SVG
use the ordinary label visibility rules. PNG remains 2× the viewport dimensions.
Camera coordinates are saved at full precision; geometry detail, glyph caches, frame
diagnostics and navigation quality levels are excluded from every portable format.
Curvature algorithms, tolerances, iteration limits and numerical exports are unchanged.

the UI is English-only and ignores the legacy
`curvature-studio:language` preference; user text remains unchanged. Up to five recent template references
(`curvature-studio:recent-templates`) and the dismissed first-use 3D hint
(`curvature-studio:orbit-hint-seen`) are optional local browser preferences. They are
excluded from project files. Template instances are stored as ordinary vertices/edges;
they do not require the template library when a project is reopened. The Bond/Brace
example uses existing edge kinds, with no new schema or calculation semantics.

Fit/manual modes and the unobscured viewport rectangle are runtime-only state.
Files continue to store the actual camera and window dimensions. Opening a file restores
its saved camera as a manual view. Fit in either view considers both axes and visible UI
panels. Canvas editing/navigation returns to manual mode. Panel changes do not reframe a
manual view; window resizing preserves zoom and the world point at the viewport centre.
The 3D off-axis projection centre follows the available UI area at Fit/resize time and is
not serialized. Fog is disabled. Drawing radii scale with the median positive edge length
(or extent when there are no nonzero edges), without modifying any vertex coordinates.

`session.panels` optionally saves the boolean visibility of `histogram`,
`inspector`, `legend`, and `hints`. `hints` controls the Interaction guide panel and `legend` controls shortcut text inside that guide (no separate legend panel). Missing settings default to true. Invalid known settings
are rejected. Older readers can open these files but ignore the new visibility settings.
Histogram visibility is separate from `histogramCollapsed` and `histogramPos`; hiding a
histogram does not remove its data or affect exports. The Results table's open state and
compact Inspector's expanded state remain transient. On a compact screen (width ≤760px
or height ≤500px), Inspector starts as a Selection details button. Closing it retains the
selection. New project keeps panel preferences; opening/undoing a project restores them.

## Document JSON

`format`: `curvature-studio/doc`
`version`: `1`
Size limits: at most 1,000 vertices and 3,000 edges.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | string | yes | Exactly `curvature-studio/doc`. |
| `version` | integer | yes | Exactly `1`. |
| `vertices` | array | yes | Vertex records. IDs are unique positive safe integers below `Number.MAX_SAFE_INTEGER`. |
| `vertices[].id` | integer | yes | Stable positive vertex ID. |
| `vertices[].x`, `vertices[].y` | number | yes | Model-space 2D position. |
| `vertices[].p3` | `[number,number,number]` | no | Model-space 3D position. |
| `vertices[].baked3d` | boolean | no | Whether ordinary 3D layout relaxation keeps this vertex fixed. This additive v1 field preserves template pins; older files without it remain readable. |
| `edges` | array | yes | Edge records. IDs and unordered endpoint pairs are unique. |
| `edges[].id` | integer | yes | Stable positive edge ID. |
| `edges[].a`, `edges[].b` | integer | yes | Existing distinct vertex IDs. |
| `edges[].kind` | string | yes | `bond` or `brace`. |
| `edges[].weight` | number | writers: yes; legacy input: no | Exactly `1` (`1.0` is equivalent). Omission means 1. Non-unit weights are unsupported. |

```json
{"format":"curvature-studio/doc","version":1,"vertices":[{"id":1,"x":0,"y":0,"p3":[0,0,0]},{"id":2,"x":64,"y":0}],"edges":[{"id":1,"a":1,"b":2,"kind":"bond","weight":1}]}
```

Unknown fields are ignored. Version mismatch rejects the whole document. The old autosave key
`curvature-studio:doc:v1` is read as a migration source only. New autosaves contain a
complete project or comparison in the IndexedDB v2 current envelope described above.

## Unit edge weights

Every serialized edge has `weight: 1`, including Brace edges. JSON numbers `1` and
`1.0` have identical meaning. A missing field in legacy input means 1; explicit
null, strings, non-finite numbers and any numeric value other than exactly 1 are
rejected before applying the document. Writers also validate runtime values, so
an unsupported weight cannot silently become 1 on save.

This applies to documents, sessions, projects, both sides of comparison workspaces
(including a hidden side), browser autosave and the input document in Results JSON.
The writer schema requires the field; readers additionally accept legacy omissions.
Polyhedron import still uses endpoint pairs `[a,b]`; generated edges have unit weight.
An arbitrary `extensions` property named `weight` remains uninterpreted extension data.

The reserved meaning is dimensionless Bond connection strength, independent of layout
coordinates, geometric length, line appearance and color thresholds. Brace remains a
hard rigid tie; its unit weight does not introduce finite stiffness or a transition
probability. No weighted calculation or weight editing UI is implemented.
`calculation.graphModel` remains `undirected-unweighted-rigid-quotient` and the engine
and parameters are unchanged. Current format versions remain unchanged because all
accepted values have exactly the existing unit-weight meaning.

Non-unit weights require incompatible document and enclosing format versions, plus
an explicitly supported calculation model/engine definition. Older readers can ignore
unknown fields: adding `weight: 2` to a v1 document would therefore be unsafe. The future
model must define transition normalization, transport distance and rigid-quotient
aggregation, with all-unit regression tests. Weight changes must enter computation
cache identities and history invalidation; layout and appearance changes must not.
See [the weight contract and future acceptance checklist](docs/model-scope.md).

canonical live edges also require explicit unit weight. Legacy omissions
are normalized at construction/import boundaries. Editor, serializer and math input
shapes share `src/graph/edge.ts`; direct math and Worker inputs reject non-unit weights.
The unchanged calculation descriptor is shared between persistence, Worker requests,
and runtime calculation/component cache identities. Runtime key strings changed; they
are not stored results or portable file identifiers. File format versions remain unchanged.

The reserved weighted types and throwing placeholder functions in
`src/math/future/weighted.ts` are NOT supported formats or calculation modes. They are
not exposed in the UI or exported through the active math entry point. See the
[implementation plan](docs/model-scope.md) for release gates.

## Style JSON

`format`: `curvature-studio/style`
`version`: `2` (version `1` is accepted as legacy input)
Size limits: at most 1,000 custom-gradient records; names are normalized to 60
characters and each gradient to 2-6 stops (3-6 for Ollivier).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format`, `version` | string, integer | yes | Tag and version above. |
| `style` | object | yes | Normalized v2 `StudioStyle`. |
| `style.shared` | object | yes | Settings shared by both views. |
| `style.shared.metricGradients` | object | yes | `keff` and `ollivier` gradient settings. |
| `style.view2d`, `style.view3d` | object | yes | Independent ornamental settings with the fields below. |
| `labelScale` | number | yes | Label scale, 0.7-2. |
| `vertexFill`, `vertexOutline`, `bondCasing` | `{enabled:boolean,color:string}` | yes | Paint settings; colors are `#RRGGBB`. |
| `vertexSize`, `vertexOutlineWidth` | number | yes | Vertex size 2-10 and outline width 0-4. |
| `verticesHidden` | boolean | yes | Hide vertices in that view. |
| `bondStyle`, `braceStyle` | string | yes | `single`, `double`, or `dashed`. |
| `bondCasingWidth`, `bondWidth` | number | yes | Casing width 0.5-4 and bond width 1-4. |
| `braceColor` | string | yes | `#RRGGBB`. |
| gradient setting | object | yes | `{type:"preset",preset:...}`, `{type:"custom",id:string}`, or `{type:"draft",name:string,stops:[...]}`. Presets: `studio`, `colorblind`, `viridis`, `coolwarm`, `grayscale`. |
| `customGradients` | array | yes | Saved gradient records. |
| saved gradient | object | yes | `{id:string,metric:"ollivier"|"keff",name:string,stops:[...]}`. |
| stop | object | yes | `{color:"#RRGGBB",position:number}`; position is 0-100. |

```json
{"format":"curvature-studio/style","version":2,"style":{"shared":{"metricGradients":{"keff":{"type":"preset","preset":"studio"},"ollivier":{"type":"preset","preset":"studio"}}},"view2d":{"labelScale":1,"vertexFill":{"enabled":true,"color":"#2A2D31"},"vertexOutline":{"enabled":true,"color":"#FFFFFF"},"vertexSize":4.5,"vertexOutlineWidth":1.5,"verticesHidden":false,"bondStyle":"single","bondCasing":{"enabled":false,"color":"#FFFFFF"},"bondCasingWidth":1.5,"braceColor":"#2A2D31","braceStyle":"double","bondWidth":2},"view3d":{"labelScale":1,"vertexFill":{"enabled":true,"color":"#2A2D31"},"vertexOutline":{"enabled":true,"color":"#FFFFFF"},"vertexSize":4.5,"vertexOutlineWidth":1.5,"verticesHidden":false,"bondStyle":"single","bondCasing":{"enabled":false,"color":"#FFFFFF"},"bondCasingWidth":1.5,"braceColor":"#2A2D31","braceStyle":"double","bondWidth":2}},"customGradients":[]}
```

Unknown fields are ignored and values are run through the app normalizers. Imported
gradients are merged: colliding IDs are remapped, and colliding names gain ` (2)`, ` (3)`,
and so on. A v1 flattened style is accepted and its ornamental settings are copied to
both views while its `metricGradients` become shared. Writers emit v2 only. Style import
is not undoable because style is not document state.

## Session JSON

`format`: `curvature-studio/session`
`version`: `2` (version `1` is accepted as legacy input)
Size limits: the embedded document and gradients use their limits above.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format`, `version` | string, integer | yes | Tag and version above. |
| `doc` | document object | yes | Complete `curvature-studio/doc` v1 object. |
| `view` | string | yes | `2d` or `3d`. |
| `metric` | string | yes | `ollivier` or `keff`. |
| `labelsVisible` | boolean | yes | Label visibility. |
| `camera2d` | object | yes | Finite `tx`, `ty` within ±1e12; `scale` between 1e-8 and 10,000. |
| `projection` | string | no | `perspective` or `orthographic`, also preserved before 3D has been opened. If a 3D camera is present, its projection must agree. |
| `viewport` | object | no | Positive `width` and `height` of the canvas viewport. Readers adjust the saved 2D center when opening on a different viewport. |
| `camera3d` | object | no | Last 3D camera; omitted until 3D is opened. |
| `camera3d.position`, `camera3d.target` | `[number,number,number]` | yes when camera exists | Camera vectors. Position must differ from target. |
| `camera3d.projection` | string | yes when camera exists | `perspective` or `orthographic`. |
| `camera3d.orthographic` | object | no | Finite `left`, `right`, `top`, `bottom`, and positive `zoom`; used for orthographic projection. Left < right and bottom < top. |
| `histogramPos` | `{x:number,y:number}` | no | Floating histogram position. |
| `histogramCollapsed` | boolean | yes | Histogram collapsed state, independent of visibility. |
| `panels` | object of booleans | no | `histogram`, `inspector`, `legend`, `hints`; omitted settings default to true. |
| `style`, `customGradients` | object, array | yes | Same v2 payload and limits as style v2. |

```json
{"format":"curvature-studio/session","version":2,"doc":{"format":"curvature-studio/doc","version":1,"vertices":[],"edges":[]},"view":"2d","metric":"keff","labelsVisible":true,"camera2d":{"tx":640,"ty":360,"scale":1},"histogramCollapsed":false,"style":{"shared":{"metricGradients":{"keff":{"type":"preset","preset":"studio"},"ollivier":{"type":"preset","preset":"studio"}}},"view2d":{"labelScale":1,"vertexFill":{"enabled":true,"color":"#2A2D31"},"vertexOutline":{"enabled":true,"color":"#FFFFFF"},"vertexSize":4.5,"vertexOutlineWidth":1.5,"verticesHidden":false,"bondStyle":"single","bondCasing":{"enabled":false,"color":"#FFFFFF"},"bondCasingWidth":1.5,"braceColor":"#2A2D31","braceStyle":"double","bondWidth":2},"view3d":{"labelScale":1,"vertexFill":{"enabled":true,"color":"#2A2D31"},"vertexOutline":{"enabled":true,"color":"#FFFFFF"},"vertexSize":4.5,"vertexOutlineWidth":1.5,"verticesHidden":false,"bondStyle":"single","bondCasing":{"enabled":false,"color":"#FFFFFF"},"bondCasingWidth":1.5,"braceColor":"#2A2D31","braceStyle":"double","bondWidth":2}},"customGradients":[]}
```

The complete payload is validated before state changes. Loading replaces the document in
one undo step; Ctrl+Z restores the pre-load document. The separate **Undo open** action
restores the complete previous project, including display settings and metadata. Opening a
session replaces its gradient library; standalone style import continues to merge libraries. Unknown fields are ignored. A v1
session is accepted with the same flattened-style migration described above; writers emit
v2 only.

## Polyhedron JSON and dmccooey text

`format`: `curvature-studio/polyhedron`
`version`: `1`
Size limits: at most 1,000 vertices and 3,000 explicit or derived edges.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format`, `version` | string, integer | yes | Tag and version above. |
| `name` | string | yes | Display name, trimmed and limited to 80 characters. |
| `vertices` | array of `[x,y,z]` | yes | Finite 3D coordinates. |
| `edges` | array of `[a,b]` | conditionally | Unique, non-self-looping, 0-based vertex pairs. |
| `faces` | array of integer arrays | conditionally | Faces of at least 3 valid 0-based indices. |

At least one of `edges` or `faces` is required. If edges are absent, each face contributes
its consecutive pairs including the closing pair. Duplicate derived pairs are collapsed;
duplicate explicit pairs are invalid. All resulting edges are bonds.

```json
{"format":"curvature-studio/polyhedron","version":1,"name":"Tetrahedron","vertices":[[1,1,1],[-1,-1,1],[-1,1,-1],[1,-1,-1]],"faces":[[0,1,2],[0,3,1],[0,2,3],[1,3,2]]}
```

The accepted UTF-8 dmccooey `.txt` subset contains arithmetic constants (`C0 = ...`),
vertices (`V0 = (C0, -C0, 1)`), and a `Faces:` section containing brace-delimited vertex
index lists, for example:

```text
C0 = 1.0
V0 = (C0, C0, C0)
V1 = (-C0, -C0, C0)
V2 = (-C0, C0, -C0)
Faces:
{0, 1, 2}
```

Constants may reference previously defined constants and use `+`, `-`, `*`, `/`,
parentheses, and `sqrt(...)`. Vertex and face indices must be contiguous/valid. The file
name becomes the imported name. Unsupported syntax or invalid topology rejects the whole
import. Unknown JSON fields are ignored; JSON version mismatch is never treated as text.

## Curvature values CSV

File name: `curvature-values.csv` from the legacy Export menu, or
`<project-name>.results.csv` from Results. UTF-8 CSV with one header and one row per drawn
edge, including braces and intra-unit bonds with empty numeric cells.
The app reads no CSV files. Size is bounded by the 3,000-edge document limit.

| Column | Meaning |
| --- | --- |
| `edge_id` | Document edge ID. |
| `vertex_a`, `vertex_b` | Endpoint vertex IDs. |
| `kind` | `bond` or `brace`. |
| `quotient_edge` | Quotient edge index, `intra`, or blank. |
| `ollivier_num`, `ollivier_den`, `ollivier` | Exact numerator/denominator and decimal Ollivier-Ricci curvature. |
| `v_inf` | Truncated variance sum V_T (legacy field name); no tail is added. |
| `k_eff` | f(V_T), an upper-side estimate in exact arithmetic, with unverified floating rounding. |
| `converged`, `iterations` | Numerical tail stopping flag and iteration count; not certification. |
| `ollivier_evidence`, `effective_evidence` | `exact-rational`, `truncated-sum` for valued bonds. |
| `termination` | `estimated-tail-tolerance` or `iteration-limit`. Tolerance 1e-10 is on the estimated variance tail, not κ error. |
| `rounding` | `unverified-floating-point` for the effective estimate. |
| `variance_bound_exact_arithmetic`, `curvature_bound_exact_arithmetic` | `lower`, `upper`; these directions are not certified floating-point enclosures. |

```csv
edge_id, vertex_a, vertex_b, kind, quotient_edge, ollivier_num, ollivier_den, ollivier, v_inf, k_eff, converged, iterations, ollivier_evidence, effective_evidence, termination, rounding, variance_bound_exact_arithmetic, curvature_bound_exact_arithmetic
1, 1, 2, bond, 0, 1, 1, 1, 2, 1, true, 50, exact-rational, truncated-sum, estimated-tail-tolerance, unverified-floating-point, lower, upper
```

Exports are enabled only when both computations have finished for the current IDs and
connectivity. The exporter itself also rejects stale or partial results. Finite but
unconverged estimates are included with `converged=false`. Display rounding never changes
CSV or results JSON numbers. Consumers should read columns by header name, including the six evidence columns. Brace/intra rows leave evidence cells empty.


## 2D figure setup

The optional project v1 `figure` field stores export settings. It is not part of
standalone document, session or style files. Older projects without it use defaults;
parsing and reserializing such a project preserves the omission. Newly captured
projects include the settings. Open, Undo open and reload restore them; New project
restores the defaults.

- `widthMm`, `heightMm`: 20–500 mm.
- `paddingMm`: 0–200 mm and less than half the shorter paper side. Additional space
  is reserved to prevent line and label clipping.
- `dpi`: integer 72–600. PNG dimensions are `round(mm * dpi / 25.4)` pixels, at most
  8192 per side and 16,777,216 total pixels. SVG and PNG share validation, including
  these size constraints.
- `background`: `white` or `transparent`.
- `range`: `fit` or `current`. The latter requires `frame: { x,y,width,height }` in
  graph coordinates: finite values with absolute value at most 1e12 and positive
  width/height. Export preserves aspect ratio and clips outside the frame.
- `labelSizePt`: 3–36 pt, multiplied by the display style's `labelScale`.
- `decimals`: integer 0–10, independent of Results precision.
- `labels`: `decimal`, `fraction` or `hidden`. Fractions apply only to Ollivier;
  effective curvature remains decimal.
- `font`: `sans-serif`, `serif` or `monospace`.

Defaults: 120×90 mm, 8 mm padding, 300 DPI, white background, fit range, 7.875 pt,
two decimal places, decimal labels and sans-serif. The SVG viewBox uses 96 px/in
for paper conversion. Projection during export does not modify graph coordinates.
PNG is rendered from the same SVG. Other than the background, decoration follows
the 2D style; editing selection and hover highlights are excluded.

The JSON Schema defines `figure`. Invalid settings are rejected on import/export,
using the shared project validation and size limits.

Gradient stop IDs exist only during UI editing. Stored stops contain `position`
and `color`. Names are trimmed on blur/Enter, not on every keystroke.

## Color threshold

Alongside preset/custom/draft gradients, `style.shared.metricGradients.keff` and
`.ollivier` accept the following. Project v1, session v2 and style v2 are unchanged.

```json
{"type":"threshold","threshold":0.5,"width":0.1,"lowColor":"#3B4CC0","highColor":"#B40426"}
```

Threshold ranges are [0,1] for effective curvature and [-1,1] for Ollivier;
width ranges are [0,1] and [0,2], respectively. Numbers must be finite and colors
must be #RRGGBB. Invalid threshold settings are rejected before applying input.

For width > 0, `t = clamp((value-threshold)/width+0.5, 0, 1)` interpolates the
colors in OKLab; values outside the transition interval use the endpoint colors.
For width = 0, values below the threshold use the low color, and values at or
above it use the high color. Nonfinite/pending values use a neutral color.
Display rounding and Results precision do not affect classification.

This is a display classification: calculations, histogram counts and bin boundaries
are unchanged. Histogram bars use their bin-centre value for coloring. The fixed
middle stop in Ollivier Custom mode does not apply to Threshold mode.

Polyhedron input has its own [v1 JSON Schema](public/schemas/polyhedron-v1.schema.json)
and [executable examples](src/import/examples.ts), separate from project files.
TXT accepts the documented subset of McCooey-style text; mathematical-expression
strings are not accepted in JSON. No external coordinate table is bundled.

## Floating panels

The optional `session.panelLayout` field retains project v1 / session v2:

```json
{"guide":{"collapsed":true,"position":{"x":76,"y":420}},"thresholdExpanded":false}
```

`guide.position` is optional; omission selects responsive default positioning.
Its x/y values must be finite with absolute value at most one million.
`guide.collapsed` and `thresholdExpanded` are booleans. Absence
of the entire panelLayout opens the guide and collapses threshold controls.
Explicit collapse, visibility and position choices are preserved. Histogram
position/collapse/visibility use `histogramPos`, `histogramCollapsed` and
`panels.histogram`. Temporarily reducing the histogram on an empty single canvas
does not change its saved collapse setting. Workspace layout is independent of
graph structure, calculation conditions and paper figure settings.

Positions are saved on drag completion or keyboard movement, not during dragging.
Display and resize constrain panels to the viewport; long content scrolls with
its header retained. A temporary correction after resizing does not overwrite
saved coordinates. Restore default panels resets positions, visibility and
expansion without changing colors or calculation values.

The threshold line and transition band are interactive controls, excluded from
histogram SVG/PNG exports. Graph and histogram colors use the saved shared style.


## Internal extension boundary

`src/project/model.ts` separates structure, layout2d, optional layout3d and presentation
without introducing a public file version. Only canonical v1 project/workspace
conversions are supported; this model is not serialized by autosave. Calculation
details visibility is session-only. All existing public versions, storage keys and
strict unit-weight/known-calculation validation remain unchanged. Planned periodic
connections, aperiodic generators and tail certificates in `math/future/` are not
accepted project inputs. See [extension foundation](docs/model-scope.md).
