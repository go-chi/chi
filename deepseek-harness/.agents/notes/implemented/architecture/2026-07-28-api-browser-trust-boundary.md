# Agent Note: One carrier-level browser-trust boundary for all `/api` routes

Status: implemented

English | [中文](2026-07-28-api-browser-trust-boundary.zh.md)

## Problem

The web GUI host serves `/api` over plain HTTP (default `127.0.0.1:3080`, `--host 0.0.0.0` supported), and the surface includes remote-code-execution-grade methods — `session.prompt` drives an agent that runs bash. A browser turns the operator into a confused deputy against such a local API in two classic ways: a malicious page fires a "simple" cross-site POST (`text/plain` — sent without a CORS preflight) whose side effects execute even though the response stays unreadable, and a DNS-rebound origin talks to the socket as if same-origin, making CORS inapplicable entirely, with only the `Host` header betraying the attacker's domain. Before this decision the system's only browser-trust check (`isTrustedNativeDialogRequest`: loopback socket + same-origin + loopback Host) guarded exactly one cosmetic route — `host.pickDirectory`, whose native dialog pops on the host's screen — while every consequential method was unguarded. Guarding per-RPC also could not survive the in-app directory browser, whose whole point is serving legitimately remote clients that a loopback rule would refuse.

## Decision

Enforce browser trust once, at the carrier, for the entire `/api` prefix — two halves:

- **Media-type fence (dsh-host-apiproxy)**: every `/api` POST must declare `application/json`, else 415 before parsing. Cross-site "simple" requests thereby stop existing: any cross-site attempt is forced into a CORS preflight this server never answers.
- **Authority fence (dsh-client-connection, `src/api-request-trust.ts`)**: every request must present a `Host` that is loopback or matches a `trustedHosts` entry (exact on `host:port`, any port on port-less entries, WHATWG-normalized; rebinding defense). Deliberately no shortcut for unmarked requests: over plain HTTP a browser attaches neither `Origin` nor Fetch-Metadata to reads (EventSource, images, navigations — those headers go only to trustworthy destinations), so an unmarked request may be a rebound browser read whose response the page can read, and Host is the one header rebinding cannot forge; non-browser clients pass via loopback, the derived LAN IP literals, or a declared authority. An attached `Origin` must equal the Host authority; `sec-fetch-site: cross-site` is refused outright. A `trustedHosts` entry that is not a bare, canonical authority fails the plugin load — WHATWG parsing would otherwise quietly authorize the hostname inside a typo or broaden an exact-port grant. `host.pickDirectory` loses its bespoke guard and rides the same fence.

Two boundaries stay deliberately out of scope: reachability is the webserver binding's policy (`host: 127.0.0.1 | 0.0.0.0`), and authentication for genuinely remote deployments is deferred work recorded in the connection README — the fence is a confused-deputy defense, not an auth layer. The old guard's loopback-socket check was dropped rather than generalized: with binding expressing reachability and `trustedHosts` naming remote authorities, the socket address adds nothing a header fence does not already cover.

## Alternatives considered

- **Per-RPC guards (status quo extended).** Rejected: the guard list trails the method list forever, the highest-value methods were already unguarded, and a loopback rule on browse RPCs would break the remote deployments they exist for.
- **CORS headers + credential omission.** Rejected: we never want cross-origin reads at all, so answering preflights only widens the surface; refusing them is strictly stronger and simpler.
- **Auth tokens now.** Rejected for this change: token minting/storage/rotation is real product surface; the fence closes the browser-deputy holes today without pre-deciding the auth design.

## Consequences

- Any future `/api` method is covered by construction; there is no per-route trust decision left to forget.
- Non-loopback deployments must have their serving authorities trusted or requests are refused. The dsh CLI keeps its advertised `--host 0.0.0.0` LAN URL working by deriving the machine's LAN IP literals into the connection row (port-less entries — an IP-literal Host cannot be a rebound name, and the bound port may be OS-assigned) and offers `dsh web --trusted-host` for named authorities; compositions the CLI does not boot declare `trustedHosts` themselves. Non-browser automation rides the same fence: loopback, a derived LAN IP, or a declared authority passes; an undeclared DNS alias is refused.
- Clients must label POST bodies `application/json` (ours always did; raw-fetch tests gained the header).
- The trusted-network assumption of an unauthenticated `0.0.0.0` deployment is now documented instead of implicit.
