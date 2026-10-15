# License and data provenance

## Application source

Application source is licensed under Apache License 2.0; see `LICENSE` and
`NOTICE`. Third-party materials retain their own licenses and attribution.

## Inter font

`public/fonts/InterVariable.woff2` is Inter, copyright the Inter Project Authors.
Its SIL Open Font License 1.1 is retained at `public/fonts/LICENSE.txt`.

## Built-in polyhedron templates

The current catalogs (`src/data/templates.json` and `quickTemplates.json`) are
produced by this project's geometric construction code under Apache-2.0.
See [the derivations and mathematical references](docs/template-construction.md).
Generation reads no external coordinate tables, previous catalogs or network data.

## npm dependencies

The exact dependency graph is pinned by `package-lock.json`; `npm ci` restores it.
Dependency packages retain their own licenses. No vendored `node_modules` or
built dependency bundle is included in the source archive. A binary
release also needs the applicable dependency notices; auditing known security
advisories is a separate check from licensing.
