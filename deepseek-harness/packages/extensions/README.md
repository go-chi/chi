# extensions/ — the agent modifies its own runtime

English | [中文](README.zh.md)

Model-facing tools over the live cordis runtime the agent itself runs inside: inspect the loaded plugins and service API, define and run model-written dynamic packages, and retract them again — plus the restricted repository Plugin runtime. Both browser-half packages live here rather than under `packages/client/` because they are halves of this subsystem's dual-half packages; the host aggregate excludes them so each face keeps its own compiler program. Design home: [the toolset Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md).

| Package | Role | ctx key |
|---|---|---|
| [`tool-cordis/`](tool-cordis/README.md) | Model-facing runtime inspection and dynamic-package tools | registers on `ctx.tools` |
| [`cordis-host-runner/`](cordis-host-runner/README.md) | Definition registry, the `node:vm` sandbox for host halves, and the request-run round trip | provides `ctx.dynamicCordisRunner` |
| [`cordis-client-runner/`](cordis-client-runner/README.md) | Browser half of a dual-half package: evaluates the definition into a live browser plugin and answers the run request | client face; provides the browser `ctx.dynamicCordisRunner` |
| [`ui-cordis/`](ui-cordis/README.md) | Browser surfaces: the frame-wide panel that operates every definition, and the read-only define card | client face; registers slots |
