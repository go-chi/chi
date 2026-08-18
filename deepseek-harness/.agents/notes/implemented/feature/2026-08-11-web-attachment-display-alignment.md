# Agent Note: Web attachment display aligns with DeepSeek Chat via attachment atoms

Status: implemented

English | [中文](2026-08-11-web-attachment-display-alignment.zh.md)

## Problem

The web composer's image surfaces missed basic usability (user feedback, issue #2248). The remove control hung outside each 72px thumbnail at `top/right: -6px`, so the rail's `overflow-x` box clipped it and clicks aimed at it often missed; previews opened only on double-click, an affordance nothing advertised except a tooltip; a rail wider than the composer produced a raw horizontal scrollbar inside the capsule; and image-intake rejections plus prompt failures (for example `attachment-error` when the selected model takes no image input) rendered as persistent inline red strips above the card. Every one of these surfaces already has a settled design in DeepSeek Chat that users know: single-click preview, an inside-the-card hover-revealed remove control, hidden-scrollbar arrow paging, and a transient top-center toast.

The first multimodal ship recorded these surfaces in the [web multimodal note](2026-07-22-web-multimodal-image-input-and-durable-attachments.md); this note supersedes its display and interaction specifics (thumbnail geometry, click affordance, error presentation) while its attachment seam, admission, and durability decisions stand.

All of this UI also lived inside `dsh-client-ui-conversation` — the rail inline in the 700-line `InputBar`, the history image and lightbox in `chat/` and `skeleton/` — with no seam that another surface could reuse and nothing enforcing the pure-props discipline the pieces already had.

## Decision

Attachment display lives in a new zero-cordis atoms package, `@deepseek-ai/dsh-client-ui-attachment` (`packages/client/ui-attachment`), patterned on `dsh-client-ui-primitives`: `AttachmentRail` (64px/16px-radius thumbnails, single-click `onOpen`, inside-the-card remove control revealed on hover or focus and permanent under `pointer: coarse`, hidden scrollbar with circular edge arrows recomputed from scroll geometry, vertical-wheel horizontal pan clamped to 60px/tick, end-reveal on growth), `MessageImage`/`ImageGallery` (single-click preview), and `ImageLightbox`. Strings arrive as label props; `ui-conversation` bridges its `conversation` dictionary through `src/client/image-labels.ts` and keeps the machine wiring (draft ids, preview state, intake callbacks). The cross-package import is sanctioned exactly because the package is an atoms library, not a client plugin: plugin-to-plugin component imports stay forbidden, and the composer's rail is composer-owned rendering, not a slot.

Both overlays body-portal: the lightbox opened from a chat message sits under transformed ancestors that would trap `position: fixed` in their own box (the backdrop covered only the chat column), so `ImageLightbox` and `Toast` render through `createPortal(document.body)` and cover the viewport from every opener. The transient banner is a `ui-primitives` `Toast` atom (120px from the viewport top, horizontally centered over its optional anchor — the composer card, so it sits over the chat column — `role="alert"`, `pointer-events: none`, three-second hold then one-second fade, `onDone` unmount, keyed per show so identical repeated messages re-announce). `InputBar` routes both intake rejections (`addImages`'s returned reason) and `promptError` through it, replacing the inline strips, and `ModelSelect` routes rejected model selections through the same atom while its in-menu strip with Retry stays the catalog-load surface; the machine-notice strip is untouched. DeepSeek Chat's source (a local reference copy) provided the target behaviors: its `ImageThumbnailInInput` (64px cards, opacity-transition delete), `ScrollArrows` (sentinel-driven paging), and `useToast` usage.

## Alternatives considered

**Keep the components inside `ui-conversation` and only restyle.** Rejected by the user: the attachment surface is expected to grow (file cards, upload progress), and the repo's plugin discipline forbids other plugins importing `ui-conversation` internals, so growth inside the plugin builds an unreusable pile. The atoms package gives the same components a sanctioned import path.

**A `ui-attachment` client plugin registering slots.** Rejected: the rail renders inside the composer the machine owns and the gallery inside chat nodes; neither is a composition hole another plugin should fill, and a plugin would force slot indirection for what are pure presentational components.

**Toast inside `ui-conversation`.** Rejected: nothing about a transient banner is conversation-specific, and `ui-primitives` is the established home for zero-cordis atoms other surfaces may reuse.

**Keep inline error strips and only add the toast for image intake.** Rejected: `promptError` (the `attachment-error` screenshot in the issue) is the surface users actually complained about, and two error presentations in one composer would leave the strip as the odd survivor.

## Consequences

The composer and history image surfaces now match DeepSeek Chat's interaction model, and the label-prop seam means the atoms render under any locale without reaching for one. The cost is a real package boundary: `ui-attachment` carries the standard scaffolding (invariant companion, bilingual README, tsconfig face, per-file 100% coverage) and item strings must be resolved by every future consumer rather than inherited. Error banners are now transient — a user who looks away for four seconds misses the message, the trade DeepSeek Chat itself makes. Non-image attachments remain unsupported; the rail's card model is ready for them but the composer's intake is image-only (tracked in the package README's limitations).
