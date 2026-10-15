# Releasing Curvature Studio

The public repository contains the application, examples and its verification
contract. Do not include credentials, user projects or generated development artifacts in releases.

1. Update `package.json`, the lockfile root version, `CITATION.cff` and
   `CHANGELOG.md` together. Preserve Apache-2.0, `NOTICE` and third-party licenses.
2. Run the checks in [reproducibility](docs/reproducibility.md) from a clean checkout.
   Keep command exit codes, tool/browser versions and WebGL status with the release.
   All required GitHub checks must pass on the commit to be tagged. An audit result
   is time-dependent; diagnose it separately from numerical test failures.
3. Review the files being released. `npm run prepare:public -- /absolute/new/path`
   produces a source inventory and verifies local documentation links. It never
   creates a remote, pushes, tags or deploys. `SOURCE_MANIFEST.json` records the
   staged source hashes; after edits regenerate it before preparing a source archive.
4. Create the version tag and GitHub release from the tested commit. Attach the
   validation record and any selected research inputs/results. Record the final CI
   URL and commit in release evidence; do not invent a successful check. Preserve
   the exact inputs/results and figure settings used in a paper separately from
   general test fixtures. Archive the release for a DOI if required by the paper.
5. Add verified paper/DOI metadata when assigned. Until then `CITATION.cff` identifies
   the software without claiming a paper identifier or supplying an unconfirmed
   author list. Update notices for new contributors and third-party material.

CI uses read-only repository permissions and runs without Cloudflare credentials.
Dependabot proposes updates weekly; it neither merges nor deploys them. Enable
private vulnerability reporting and require the verification check on the main
branch. Repository settings are not configured by the workflow itself.

## Website deployment is separate

`npm run qa:hosting` tests local Cloudflare emulation and does not publish.
`npm run deploy` performs an explicit authenticated deployment. Fork maintainers
must choose their own Worker name/account in `wrangler.jsonc`; the checked-in name
identifies the maintained website. Wrangler telemetry is disabled there.

Never put a Cloudflare token into the source tree or ordinary test CI. A website
update does not replace a versioned research archive. Record which software commit
was deployed; do not silently move release tags to track the live website.
