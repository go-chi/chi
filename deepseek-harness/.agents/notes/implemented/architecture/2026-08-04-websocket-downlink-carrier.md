# Agent Note: WebSocket carrier for browser downlinks

Status: implemented

English | [中文](2026-08-04-websocket-downlink-carrier.zh.md)

## Problem

The browser Web GUI has long used two SSE responses for `events.mux` and `events.host`. HTTP/1.1 browsers typically allow only about six concurrent connections per origin; each page permanently occupying two makes same-origin tabs, plugin resources, and ordinary RPCs contend for connection slots, and reaching the limit causes requests to queue rather than merely slowing them down. The RPC protocol itself is channel-independent: a constraint of the browser's physical carrier must not leak into the session/runtime object layer.

## Decision

The real browser carrier opens one independent WebSocket for each downlink stream class: `/api/events.mux` sends only `MuxFrame`, and `/api/events.host` sends only `HostFrame`. Each text message is one complete `ServerRequest` JSON document; the client continues to validate the envelope first, then the concrete frame union for that path, and passes the narrow `RpcRequest<Frame>` form to the existing `ConnectionController`. The streams retain independent lifecycles and provide no cross-stream ordering guarantee; either one ending still fails the entire connection generation and rebuilds it under the existing backoff policy.

WebSocket carries only the host→browser downlink. All client→host unary calls and `respond` operations for server requests continue to use the existing `POST /api/*`; the WebSocket accepts no client application messages. `WebApiClient` therefore holds HTTP `fetch` for uplink and WebSocket for downlink, while the fixture and `InProcessApiClient(toFetchHandler(api))` continue to implement the same two-stream `IApiClient` abstraction. The in-process fetch carrier retains SSE encoding and decoding to verify the channel-independent protocol's isomorphism, but network GET requests to `/api/events.*` answer only Upgrade Required and do not provide a browser compatibility fallback.

## Upgrade and lifecycle boundaries

`dsh-host-webserver` provides an exact upgrade-route registration point alongside ordinary routes, dispatches Node upgrade sockets by pathname only, contains raw-socket errors, and waits for surviving upgraded connections to close during server teardown; it knows nothing about Harness frames or WebSocket messages. `dsh-client-connection` owns the WebSocket handshake, frame output, and stream cancellation, and reuses the `/api` Host/Origin trust fence before upgrade. An untrusted authority or cross-origin Origin is rejected before `ctx.apiProxy.events.*` starts.

A browser abort or socket close cancels the corresponding host stream; plugin teardown also waits for that source iterator's cleanup. If a host stream throws midway, the carrier sends one existing `stream/error` frame and then closes the socket; the client treats that frame as connection loss rather than delivering it to a business sink. Each WebSocket reports open independently, and the existing readiness handshake still waits until mux and host are both open and the `host.describe` HTTP call has succeeded before publishing connected.

## Verification

Webserver contract tests pin upgrade-pathname dispatch, duplicate-registration rejection, disposal, and teardown; connection real-network tests pin each WebSocket's trust check, open, schema envelope, frame order, stream error, and close cancellation; client tests also prove that downlinks create `ws:`/`wss:` URLs while unary calls and `respond` still use HTTP `fetch`. The assembled keyless browser replay continues to cover Chromium, a real host, HTTP uplink, and the full WebSocket downlink chain.

## Alternatives considered

**Multiplex mux and host over one WebSocket.** This would add a channel tag, a multiplexing queue, and a single-connection backpressure policy, and would change the existing two-stream readiness semantics. Two WebSockets already avoid the HTTP/1.1 six-connection limit while keeping this change in the physical carrier layer.

**Move unary calls and respond to a full-duplex WebSocket as well.** This would rewrite timeout, cancellation, HTTP-status, trust-fence, and request-correlation behavior without adding any benefit for the current downlink connection-slot problem. HTTP uplink is an explicitly retained boundary.

**Keep a network SSE fallback.** Two carriers would let the production browser path silently fork because of proxy or handshake differences and would leave the connection-limit problem in a supported branch. During prerelease, only WebSocket downlink ships; the existing reconnect behavior and connection state expose failures explicitly.

**Rely on HTTP/2 for greater connection concurrency.** The built-in development server uses plaintext Node HTTP/1.1, and a deployment's fronting proxy is not a product invariant. The physical downlink directly uses a browser primitive outside that connection pool.

## Consequences

Each Web page still has two long-lived downlink connections, but they no longer consume the browser's six-connection HTTP/1.1 quota. The runtime continues to consume the original two streams and retains all reconnect, stream-repair, and cross-stream unordered semantics. The cost is one more upgrade-registration surface in the webserver, a WebSocket implementation dependency in the connection package's host half, and separate maintenance of the browser WebSocket and in-process SSE physical codecs. They share the same `ServerRequest`/frame schemas and `IApiClient` semantics, avoiding a second application protocol.
