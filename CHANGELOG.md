# Changelog

## 0.9.0 (2016-03-31)

- Reuse context objects via sync.Pool for zero-allocation routing [#33](https://github.com/pressly/chi/pull/33)
- BREAKING NOTE: due to subtle API changes, previously `chi.URLParams(ctx)["id"]` used to access url parameters
  has changed to: `chi.URLParam(ctx, "id")`
