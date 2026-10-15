# Curvature Studio

A browser application for editing finite graphs and comparing **effective curvature**
and **Ollivier–Ricci curvature**. Computation, project storage and figure export run
on your device; no graph-processing server or account is required.

[Try the application](https://studio.curvature.workers.dev) ·
[User guide](docs/user-guide.md) · [Mathematical definition and validation](docs/math-validation.md) ·
[File formats](FORMATS.md) · [Reproduce a calculation](docs/reproducibility.md)

## What is computed

The supported model is a finite, undirected, unit-weight graph. Brace-connected
vertices form rigid units; calculations use the **simple quotient graph** of
those units. Repeated contacts become one quotient edge. A Bond within a rigid
unit has no curvature value. Both metrics use a walk with holding probability 1/2.

Effective curvature is computed from a truncated infinite variance sum.
**Converged means the numerical stopping rule was met; it is not a certified
error bound.** Ollivier results include rational fractions. See the
[definitions, normalization and limitations](docs/math-validation.md) before
interpreting results. Color thresholds and 2D/3D coordinates affect appearance,
not curvature. Weighted, periodic and aperiodic solvers are not implemented.

## Run locally

Use Node.js 22 (at least 22.12) and npm. From the directory containing this file:

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open the address printed by Vite. To serve a production build locally:

```sh
npm run build
npx vite preview --host 127.0.0.1
```

Use localhost or HTTPS: browser persistence uses secure-context APIs.
No cloud credentials, Lean installation, Python environment or manuscript
checkout is required. WebGL is needed for 3D; 2D remains available without it.
The editor accepts up to 1,000 vertices and 3,000 edges. Save project files for
long-term storage: browser storage is local to the browser and site address.

## Typical workflow

1. Open [the Cube example](examples/cube-study.curvature.json) in the app, or add a template.
2. Select a metric and open **Results** for values, fractions and calculation status.
3. Use **Compare** to copy the graph and edit one side. **Single view** keeps both
   structures; **End comparison…** keeps one and discards the other after confirmation.
4. Download the project and results JSON for reproducibility. Use **Figure setup
   (2D)** for paper dimensions, labels and SVG/PNG output.

[The guide](docs/user-guide.md) covers Bond/Brace semantics, panels, colors,
comparison, import formats and saving.

## Verify the implementation

```sh
npm run check
npm run test:math-sensitivity
npx playwright install --with-deps chromium firefox webkit
npm run qa:cross-browser
QA_REQUIRE_WEBGL=1 npm run qa:math
npm run qa:templates
npm run qa:hosting
```

`check` verifies regenerated template catalogs and includes independent numerical references, closed-form examples,
quotient semantics, persistence and worker protocol tests. The exhaustive small
graph corpus covers **all 30 connected simple graph types on 2–5 vertices**, in
771 labelled realizations. The labelled cases test indexing as well as topology;
they are not 771 different topologies. Larger analytic families, disconnected
graphs, rigid contraction and real-browser per-edge outputs test separate risks.
See [the validation map](docs/math-validation.md), including what is not covered.

CI performs these checks without deployment credentials. Weekly dependency
checks propose pull requests; they do not merge or deploy automatically.
[Contributing](CONTRIBUTING.md) describes focused checks and regression reports.

The [reproduction guide](docs/reproducibility.md) maps each check to its inputs
and output artifacts, and explains how to preserve a calculation for publication.
The bundled examples and validation fixtures are not a complete manuscript
figure-reproduction dataset.

## Project layout

- `src/math/`: finite graph kernels, quotient construction and Worker protocol.
- `src/state/`, `src/project/`, `src/storage/`: editing, formats and local persistence.
- `src/view2d/`, `src/view3d/`, `src/ui/`, `src/export/`: interaction, rendering and outputs.
- `qa/`: browser checks and mathematical fixtures; generated evidence goes to `qa/artifacts/`.
- `examples/`, `public/schemas/`: importable projects and format schemas.
- `src/math/future/`: reserved contracts only, excluded from runtime calculations.

## Reuse and citation

The application source and independently generated template catalog follow the
[Apache-2.0 license](LICENSE). See the
[template construction](docs/template-construction.md) for derivations and
reproduction, and [THIRD_PARTY.md](THIRD_PARTY.md) for the separately licensed
Inter font and provenance history. Older source archives used external coordinate
tables and are not the current release candidate.

For research, cite the software using [CITATION.cff](CITATION.cff) and record the
release tag/commit, project/results JSON and calculation definition. Software
author and copyright holder: Daishi Fujita. A final paper citation or archived
software DOI will be added when assigned; none is inferred here. The website may
advance independently of an archived paper release. See the
[release checklist](RELEASING.md) for release maintenance.

See [changes](CHANGELOG.md) and [security reporting](SECURITY.md) for maintenance information.
