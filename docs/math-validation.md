# Mathematical validation for the paper companion app

This is the executable contract for the **finite, undirected, unit-weight**
calculation. Tests are runnable from this application directory; they do not
require Lean, Python, private manuscript files, cloud credentials, or a server API.
They do not enable the reserved weighted, periodic or aperiodic solvers.

## Definition and correspondence

For the simple graph after rigid-unit contraction, use the row-stochastic kernel

\[
P_{uv}=\tfrac12[\,u=v\,]+\frac{[\,u\sim v\,]}{2\deg u},\quad
q_e=\delta_u-\delta_v,\quad
V_\infty(e)=\sum_{j\ge0}\|q_e^\top P^j\|_2^2.
\]

The norm is ordinary counting-measure Euclidean norm, not a degree-weighted norm.
The paper's effective curvature is
\(\kappa_{\rm eff}(e)=1-\sqrt{1-2/V_\infty(e)}\).
Ollivier curvature on a unit-length edge is \(1-W_1(P_u,P_v)\).
The production code uses an algebraically equivalent rationalized expression for
effective curvature to avoid subtractive cancellation. Coordinate scale, view,
label precision and color threshold do not define the calculation.

| Paper/app contract | Executable evidence |
|---|---|
| Half-lazy kernel, row dipole, unweighted norm, fresh-noise term 2, effective-curvature formula | `src/math/__tests__/paper-contract.test.ts`: independent covariance reference and exact-value anchors |
| One-step transport with graph distance | Same test: exhaustive integer Lipschitz dual, independent of production min-cost flow; checks both decimals and rational fractions |
| General nonregular small graphs | All 771 connected labelled simple graphs on 2–5 vertices, all 4,294 edges (30 isomorphism classes); reversed input order/orientation and nonsequential IDs |
| Larger degree and batch boundaries | Added star K(1,m) closed forms for m=2,7,33,65; all effective values and one exact transport fraction per star |
| Longer relaxation and closed-form families | `golden.test.ts`: cycle Fourier formula through C128 with signed truncation-gap checks, bridge, Cube, P3, K4 |
| Numerical regression snapshots (not independent oracles) | Rhombic dodecahedron in `golden.test.ts`, J37/RCO fingerprints, and `efficiency.test.ts` pre-optimization snapshots |
| Rigid-unit interpretation | Existing quotient metamorphic tests: K4/Brace → C3, P4/Brace → P3, duplicate contacts, internal Bonds; transitive rigid unit → P4 with duplicate contacts and an intra-unit Bond; browser Braced K4 case |
| Computation identity and partial results | Existing `foundation.test.ts`, `results.test.ts`, `edgeWeight.test.ts`: stale/foreign replies, pending values, unsupported weights/conditions, export validation |
| Result reaches the intended edge and metric | `qa:math`: real import, Worker, Results table, CSV/JSON downloads, 2D edge labels, 3D glyph creation and per-edge projected SVG labels |

The definitions correspond to the paper’s half-lazy kernel, accumulated dipole
variance, effective-curvature transform and edge-covariance/Stein equation.
Record the software release and the applicable paper version when reporting a calculation. The definitions here are self-contained; no private manuscript path
is part of the public test contract.

## Independent reference, deliberately small

`src/math/__tests__/reference.ts` imports **no production code**. For effective
curvature it forms \(H=I-\mathbf1\mathbf1^\top/n\), \(B=HP\), and solves

\[
S-BSB^\top=H,\qquad V_\infty(u,v)=S_{uu}+S_{vv}-2S_{uv}.
\]

Why this works even for an irregular graph: P1=1, so HP=HPH. For a zero-sum
row dipole, qᵀ(HP)^j=qᵀP^j and qᵀP^jH=qᵀP^j. The restriction of HP
to the zero-sum subspace is stable for a connected half-lazy finite graph.
Thus S=Σ B^j H(Bᵀ)^j gives qᵀSq=Σ‖qᵀP^j‖². The uniform H fixes the
constant gauge; it is **not** a claim that the stationary distribution is uniform.

This is a dense linear solve with partial pivoting and a residual check, not the
production time iteration or its estimated-tail termination rule. The reference
is bounded to at most 8 vertices. It is also floating point, **not an interval or
exact-arithmetic certificate**. Checking it against closed-form anchors guards
against shared normalization/orientation mistakes. Small linear residual alone
does not prove small forward error on arbitrary ill-conditioned systems.

For Ollivier curvature, enumerate integer 1-Lipschitz potentials with one vertex
fixed at zero. Their ranges are bounded by graph distances from that vertex.
Integer edge-difference constraints admit an integral optimum; maximizing the
difference of the two half-lazy expectations therefore gives the transport dual.
This bounded reference is only used on graphs of order 2–5.

The exhaustive test uses absolute tolerances of `1e-9` for V/effective curvature
and `1e-12` for Ollivier values. The covariance anchor tolerance is `1e-11`.
These are acceptance thresholds **for this finite test corpus**, not global
error claims. Known values in `qa/fixtures/paper-values.json` are rational V and
Ollivier values, never snapshots generated by the production solver:

| Structure / edge | V∞ | Ollivier |
|---|---:|---:|
| K2 | 2 | 1 |
| P3, either edge | 13/6 | 1/2 |
| K4, any edge | 9/4 | 2/3 |
| Cube Q3, any edge | 101/40 | 1/3 |
| Two K4 joined by one bridge: bridge | 250/59 | −1/2 |
| Same graph: clique edge incident to bridge endpoint | 262159/107380 | 5/12 |
| Same graph: clique edge away from bridge endpoint | 9/4 | 2/3 |
| K4 with one Brace, remaining drawn Bonds via C3 | 32/15 | 3/4 |
| P4, terminal / middle edge | 232/105 / 18/7 | 1/2 / 0 |

Every drawn Bond in all seven browser fixtures now has an independent expected
value: 42 edges per metric. In the bridged K4 graph the three classes have
multiplicities 1/6/6. The clique dipole away from the bridge is a left eigenvector
with eigenvalue 1/3, giving V=2/(1−1/9)=9/4; the other classes follow from the
rational Stein solve. This graph and P4 detect misassignment between unequal edges.

The `pre-optimization.json` fixture in the unit tests is a production snapshot
recorded before optimization. It protects behavior
across refactoring; it is not one of the independently derived values above.

## Coverage is defined by failure modes, not test counts

The exhaustive domain contains 1, 4, 38 and 728 labelled connected simple graphs
on 2, 3, 4 and 5 vertices. Canonicalization by **all vertex permutations** checks
that these represent 1, 2, 6 and 21 different topology types, respectively: 30
in total. Isomorphic labellings intentionally remain in the suite to exercise
index/order dependence. The suite is exhaustive only on this bounded, unbraced,
connected domain, not on all supported editor inputs or all graph sizes.
Its maximum possible degree and diameter are four. Brace configurations are
tested by chosen semantic examples, not exhaustively enumerated.

| Distinct risk | Complementary evidence |
|---|---|
| Wrong row/column convention or norm | Irregular small graphs, P3/P4, star family; reference covariance solve |
| Wrong holding probability or missing j=0 noise | Exact K2/P3/K4 values and analytic families |
| Transport algorithm error | Independent integer-potential dual on every edge in the small corpus |
| Relabelled IDs or mixed component indexing | P4 relabelling/disjoint-union test interleaves triangle edges and an isolated vertex |
| Transitive Brace or duplicate-contact semantics | Manually specified P4 quotient, unequal edge classes, two contacts to one quotient edge |
| Large degree / batch boundary | Star family up to 65 leaves crosses 32-dipole batches with an analytic value |
| Slow modes absent from tiny graphs | Cycle Fourier formula through C128; bridge case; finite iteration limits |
| Correct values assigned to the wrong drawn edge | P4 has both edge classes checked in Results, CSV/JSON, 2D labels and projected 3D SVG |
| Rounded text mistaken for evidence | Full-precision downloads, fractions, explicit non-certified and nonconverged status |

The P4 fractions can be reproduced by solving the displayed Stein equation over
rationals for degrees (1,2,2,1). Its two edge classes have visibly different values,
so returning the same value for every edge cannot pass. For stars with m leaves,
qᵀP^j (j≥1) is zero at the centre and equals 2^-j(1/m−δ_leaf) on leaves.
Summing the geometric series yields V=2+(m−1)/(3m); transport between different
leaves costs two, giving Ollivier=1/m. These are analytic checks beyond small-graph
enumeration, not production-generated snapshots. Old pre-optimization/J37
fingerprints guard regression but are not independent mathematical derivations.

`npm run test:math-sensitivity` first runs an unchanged temporary copy, then
introduces four intentional errors in separate copies: wrong degree index
(row/column error), omitted fresh-noise term, changed holding probability, and
assigning every Bond the first edge's value. It requires a numerical anchor
assertion failure, not a compilation/startup failure. It never edits live source.
This is a small, inspectable negative-control check, not a mutation coverage score.

## Commands and CI

```sh
npm ci
npm run check
npm run test:math-sensitivity
QA_REQUIRE_WEBGL=1 npm run qa:math
```

`check` runs the reference tests with the normal unit suite and builds production
assets. `qa:math` then serves that build on dedicated port 5201, creates an
isolated Chromium context, and exercises seven graph fixtures × two metrics ×
2D/3D. It collects actual CSV/JSON/SVG downloads under
`qa/artifacts/math-contract/`. No existing user browser storage is accessed.
The CI workflow requires WebGL for this suite; unavailable WebGL is a failure,
not a successful substitute. Direct local execution without the flag can report
a 3D skip explicitly. Existing cross-browser QA remains a separate check.

The 2D checks identify individual edge labels in the DOM. The 3D checks observe
text drawn into real label textures without replacing rendering, and associate
downloaded SVG labels with the checked edges' projected positions. They do not
perform OCR of on-screen pixels, prove every texture's placement, or measure
physical GPU performance. SVG label multiplicities and Brace label exclusion
are checked as well. Repeated imports in the same page exercise stale-result
invalidation.

## Limits that must remain visible

The production `vInf` field currently holds the **truncated sum**, not the exact
infinite sum. Its `1e-10` stopping tolerance concerns an **estimated variance
tail**, not a certified effective-curvature error. In exact arithmetic truncation
underestimates V and overestimates effective curvature; floating rounding is not
certified. The short-iteration test checks the direction of that approximation
and nonconvergence flags. It does not turn the stopping rule into a proof.

This suite is regression evidence for the stated finite model, not a proof for
every graph, a proof of the JavaScript implementation in Lean, or validation of
future weighted/infinite-domain solvers. A general tail certificate and arbitrary
graph interval arithmetic are intentionally outside this release task. Expand
the fixture contract whenever the paper's definition or the supported model
changes; do not update expected values merely to match a failing implementation.
