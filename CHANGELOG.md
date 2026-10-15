# Changelog

Public releases start at **0.1.0**, based on the internal development version
0.5.11. Internal version numbers are not the public release sequence. The initial
commit is a curated source snapshot; it does not include the development history
or unpublished research files from the parent workspace.

## 0.1.0 — 2026-10-15

- Replaced externally sourced polyhedron coordinate tables with independent,
  reproducible geometric constructions for the built-in template catalog.
- Canonicalized oriented face cycles and face ordering so template regeneration
  does not depend on the atan2 branch-cut convention of the CPU/backend.
- Added geometry checks for face types, regularity, convexity and closed surfaces,
  plus browser checks of every built-in template and its image exports.
- Strengthened mathematical validation with independent covariance and transport
  references, exhaustive small-graph topology coverage, complementary analytic
  families and Brace/component cases, and deliberate numerical-error controls.
- Checked unequal edge classes through actual Worker results, Results tables,
  CSV/JSON downloads, 2D labels and projected 3D SVG labels.
- Prepared standalone installation, provenance, model-scope and reproducibility
  documentation. CI verifies the app without automatically deploying it.

The application supports finite, undirected, unit-weight graphs. Weighted,
periodic and aperiodic calculation modules remain reserved interfaces only.
See [mathematical validation](docs/math-validation.md) for numerical limitations.
