# Supported model and extension boundary

The current calculation identifier is `curvature-studio/math@1`, with graph model
`undirected-unweighted-rigid-quotient`, laziness 0.5, estimated variance tail
tolerance 1e-10 and maximum 200,000 iterations. See [mathematical validation](math-validation.md).

Project edges explicitly store numeric `weight: 1`. Omission in accepted older
input normalizes to 1. Non-unit, malformed or unknown calculation conditions are
rejected before applying the project, including a hidden comparison side.
Arbitrary annotation in `extensions` is retained but is not calculation input.

Future weighted graphs need a specified conductance/walk and noise convention,
a versioned quotient/parallel-edge rule, independent examples and a new result
identity. Periodic graphs also need cell offsets and a finite/infinite-domain
contract. Aperiodic patches need boundary and tail semantics. Reserved modules
in `src/math/future/` describe those boundaries; they are not implemented solvers.

Graph structure, layout, style and workspace state are distinct internal owners.
The present serialized project wraps them in a session; comparison files preserve
both projects. Unknown calculation semantics must never silently fall back to
unit-weight finite computation. Display changes cannot invalidate or redefine
mathematical results; structural changes must invalidate stale results.
