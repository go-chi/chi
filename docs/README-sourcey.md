# Sourcey API reference

This directory contains a reproducible Sourcey 3.6.5 documentation build for
the public Go APIs in `github.com/go-chi/chi/v5` and its `middleware` package.

The checked-in `godoc.json` snapshot was generated from commit
`8b258c7bb28f97a5f2a856ff7ef962578fec9215`. Source links in the rendered site
are pinned to that same commit so the reference remains auditable.

## Rebuild

```console
npm ci
npx sourcey godoc --config sourcey.config.ts
npm run build
```

The static site is written to `docs/site`. It includes the root package and
middleware package, covering 83 top-level exported API entries before methods.
