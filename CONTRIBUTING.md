# Contributing and reporting problems

Use Node.js 22 and `npm ci`. Keep calculation semantics, display styling and
persistence changes separate where practical. Do not update reference values to
match a changed implementation without deriving the new expected result.

Before proposing changes, run `npm run check`. For mathematical or display
changes also run `QA_REQUIRE_WEBGL=1 npm run qa:math` after building. Use
`npm run qa:cross-browser` for common browser behavior and `npm run qa:hosting`
for CSP/static asset changes. Install the Playwright browsers as in the README.
Browser suites use dedicated ports and isolated browser storage; run them
sequentially. Performance measurements should run without concurrent builds/QA.

Useful focused checks:

| Changed behavior | Check |
|---|---|
| Math/quotient/Worker | `npm test -- src/math` and `npm run qa:math` |
| Comparison and storage | `npm run qa:comparison`, `npm run qa:end-comparison` |
| Figures/labels | `npm run qa:figures`, `npm run qa:math` |
| 3D lifecycle and navigation | `npm run qa:reopen3d`, `npm run qa:navigation` |
| Import errors and layout | `npm run qa:imports-layout` |

Storage/CAS/migration semantics have self-contained unit tests in
`src/storage/__tests__/`, included in `npm run check`.

Record the commit, commands, exit codes, browser/OS and WebGL availability.
A skipped WebGL path is not a 3D pass. Generated reports/screenshots are under
`qa/artifacts/`; do not reuse old reports or commit user project data. Software
WebGL is not a physical GPU benchmark.

For a numerical issue, provide a minimal project, edge ID, exact graph/Brace
roles, calculation settings, expected value and its derivation, results JSON,
and convergence status. Include version, metric and both full precision and
rounded display values. For UI issues, include steps and viewport size.

For security reports, avoid posting exploit data or private user projects in a
public issue. Use the repository's private vulnerability reporting channel when
available; publication setup must establish that channel before accepting reports.
No external telemetry or report collection endpoint is provided by the app.

Changes to the mathematical model require a separately versioned calculation
contract, unsupported-input rejection and new independent references. Reserved
weighted/periodic modules are not a feature toggle for unvalidated mathematics.
