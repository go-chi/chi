/**
 * Pure React attachment atoms (zero cordis): the composer draft-image rail,
 * the chat-history image gallery, the original-image lightbox, and the
 * full-page drop overlay. Owners resolve every string through their own
 * locale namespace and pass it down; nothing here reads application state.
 * @module @deepseek-ai/dsh-client-ui-attachment
 */

export { AttachmentRail } from './AttachmentRail.tsx'
export type { AttachmentRailItem, AttachmentRailLabels } from './AttachmentRail.tsx'
export { DropOverlay } from './DropOverlay.tsx'
export type { DropOverlayLabels } from './DropOverlay.tsx'
export { ImageLightbox } from './ImageLightbox.tsx'
export type { ImageLightboxLabels } from './ImageLightbox.tsx'
export { ImageGallery, MessageImage } from './MessageImage.tsx'
export type { ImageLoader, MessageImageLabels } from './MessageImage.tsx'
