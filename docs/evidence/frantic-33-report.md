# Sourcey documentation report for go-chi/chi

- **Target and pin:** `go-chi/chi` at upstream commit `8b258c7bb28f97a5f2a856ff7ef962578fec9215`.
- **Maintenance and license:** MIT-licensed project; recent upstream activity was confirmed on 2026-07-05 before selection.
- **Input coverage:** 78 Go source files. Sourcey `godoc` captured the root and middleware packages with 83 top-level public entries, plus documented methods and examples where present.
- **Build:** Sourcey 3.6.5 reads `docs/godoc.json` through `docs/sourcey.config.ts` and produces three navigable API-reference pages, search, sitemap, LLM exports, and Open Graph assets.
- **Source traceability:** Generated pages contain 180 links pinned to the selected upstream commit.
- **Public validation:** The site root, root-package page, and middleware page returned HTTP 200. Their observed response sizes were 107205, 107238, and 138848 bytes.
- **Governed validation:** Runx CLI 0.8.2 sealed run `run_sourcey_6a9cd659cd197404`; receipt `sha256:9f1a7499cd70394c3b0e4b9885e13aa74f70616f882122542978d4b1652c2751` covers discovery, approval, two deterministic builds, critique, bounded revision, verification, and packaging.
- **Public site:** https://kais12349.github.io/chi/
- **Maintainer adoption path:** https://github.com/go-chi/chi/pull/1147

## Maintainer-facing gaps

- The current site intentionally concentrates on generated API reference. Narrative guides, recipes, and architecture notes remain in the repository README and examples rather than being duplicated.
- The live copy is hosted from the contributor fork while the upstream pull request is reviewed. If accepted, maintainers can publish the same reproducible build from an upstream-controlled documentation home.
- The snapshot is commit-pinned for reviewability. A future CI job should regenerate `docs/godoc.json` when the upstream branch advances, review the diff, and rebuild the public site.