# License and data provenance

## Application source

The parent research repository supplies Apache License 2.0; a verbatim copy is
included as `LICENSE` for the standalone source. This does not relicense the
third-party materials below. The source copyright notice is in `NOTICE`. Changes to bundled assets must
retain their own attribution and redistribution terms.

## Inter font

`public/fonts/InterVariable.woff2` is Inter, copyright the Inter Project Authors.
Its SIL Open Font License 1.1 is retained at `public/fonts/LICENSE.txt`.

## Built-in polyhedron templates

The current catalogs (`src/data/templates.json` and `quickTemplates.json`) are
produced by this project's geometric construction code under Apache-2.0.
See [the derivations and mathematical references](docs/template-construction.md).
Generation reads no external coordinate tables, previous catalogs or network data.

Earlier versions used 14 coordinate tables from David I. McCooey's
[Visual Polyhedra](https://dmccooey.com/polyhedra/), whose redistribution permission
had not been established. Those tables, their parser and their baked catalog
entries were replaced on 2026-10-15. No permission is claimed or inferred.
The previous restriction applies to old archives/history; it is not resolved by
relicensing them. Publish a fresh staged tree rather than the research repository's
history. The user-import text parser remains, without any bundled external table.

## npm dependencies

The exact dependency graph is pinned by `package-lock.json`; `npm ci` restores it.
Dependency packages retain their own licenses. No vendored `node_modules` or
built dependency bundle is included in the source staging directory. A binary
release also needs the applicable dependency notices; auditing known security
advisories is a separate check from licensing.
