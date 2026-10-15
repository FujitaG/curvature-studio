# Reproducing a calculation

Curvature Studio is an interactive companion application. This repository ships
mathematical reference cases and example projects, not the complete set of inputs
or figure-generation scripts for an associated manuscript. No manuscript figure
number or unpublished bibliographic identifier is assigned to these examples.

## One example from input to figure

1. Use a tagged source release, install Node.js 22, and run `npm ci` followed by
   `npm run build` and `npx vite preview --host 127.0.0.1`.
2. Open `examples/cube-study.curvature.json` using **Open project**. Choose a metric
   and open **Results**. On every Cube edge, Ollivier curvature is 1/3 and the
   infinite-sum reference variance is 101/40. Effective curvature is
   `1 - sqrt(21/101)`; the app evaluates a truncated sum subject to its stopping rule.
3. Download results JSON and CSV from **Results**. Check the calculation settings,
   convergence status and full-precision values, rather than just rounded labels.
4. Set dimensions, background, labels and range in **Figure setup (2D)**. Save the
   figure settings in the project, then export SVG or PNG.
5. Save the project file as well as the figure. If comparing two structures, use
   **Save comparison (A + B)** to preserve both sides.

Keep the exact source tag/commit, project or comparison JSON, results JSON,
exported figure, and browser version together. A screenshot or the website URL
alone does not record the graph and calculation. Browser storage is a working
copy, not an archival record. The public website can advance beyond a paper's
archived software version.

## Executable evidence index

Run commands from the repository root. Start with `npm ci`. Install browsers once
with `npx playwright install --with-deps chromium firefox webkit`. Run browser
suites sequentially; they create isolated browser contexts and dedicated servers.
Leave `QA_BASE_URL` unset to test the local checkout.

| Purpose | Input / independent reference | Command | Evidence |
|---|---|---|---|
| Mathematical semantics, formats and build | `src/math/__tests__/reference.ts`, exact anchors, analytic families and all connected simple graphs on 2–5 vertices | `npm run check` | Test/build output; `dist/` is the local application build |
| Detect deliberately wrong mathematics | Four explicit mutations in `scripts/check-math-sensitivity.mjs` | `npm run test:math-sensitivity` | Numerical assertion failures in temporary copies; live source is unchanged |
| Values reach the intended edge and exported file | `qa/fixtures/paper-values.json` (rational expected values) | `QA_REQUIRE_WEBGL=1 npm run qa:math` after `npm run build` | `qa/artifacts/math-contract/report.json`, numbered results JSON/CSV and 2D/3D SVG files |
| Reproduce independent template geometry | `scripts/polyhedra.mjs`, elementary constructions in `scripts/generate-templates.mjs` | `npm run bake:check` | Read-only comparison with the checked-in catalogs; geometry tests are included in `check` |
| Template drawing and export | All 20 built-in polyhedron templates | `npm run qa:templates` after `npm run build` | `qa/artifacts/templates/` with report and actual exports; WebGL is required |
| Browser compatibility | Common editing and export operations | `npm run qa:cross-browser` after `npm run build` | `qa/artifacts/cross-browser/`; inspect rendered versus fallback paths |
| Static hosting policy | Built assets and `public/_headers` | `npm run qa:hosting` after `npm run build` | `qa/artifacts/hosting/`; local Cloudflare emulation, no deployment credentials |

Generated QA evidence is ignored by Git. Copy the reports and inputs you intend
to archive before another run; suites can overwrite their own output directories.
A report left by an earlier successful run is not evidence that a later run passed.
Retain command exit codes and distinguish unavailable WebGL from a rendered 3D pass.

## What agreement means

See [mathematical validation](math-validation.md) for derivations, tolerances and
coverage limits. Independent analytic/oracle checks and production snapshots have
different purposes and are labelled separately. The estimated variance-tail
stopping rule is not a certified effective-curvature error bound. SVG fonts are
not embedded; PNG dimensions are reproducible settings, but screenshots and raster
output can differ with browser, fonts and graphics backend. Headless software
WebGL checks are not physical-GPU performance measurements.

The first public software release can be cited by repository URL and immutable
tag/commit. Add the paper's final citation and archived software DOI only when
assigned. Paper-specific inputs and figure mappings should be added and reviewed
when those artifacts are selected, without relabelling test fixtures as paper data.
