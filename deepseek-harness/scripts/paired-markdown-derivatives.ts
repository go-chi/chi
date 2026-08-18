/**
 * Separate byte-identical Chinese Markdown code blocks from the primary checks
 * performed on their unsuffixed English siblings. The bilingual pairing gate
 * owns cross-language identity; source-oriented gates consume one copy.
 */

/** The result of separating canonical blocks from paired Chinese derivatives. */
export interface MarkdownDerivativePartition<T> {
  /** Blocks that still require the caller's owning check. */
  primary: T[]
  /** Chinese blocks covered by the byte-identical unsuffixed sequence. */
  derivatives: T[]
}

/** Return the unsuffixed sibling of a Chinese Markdown path. */
function unsuffixedSibling(doc: string): string | null {
  return doc.endsWith('.zh.md') ? `${doc.slice(0, -'.zh.md'.length)}.md` : null
}

/**
 * Partition complete byte-identical `.zh.md` block sequences from primary
 * blocks. A partial or reordered match stays primary so the caller fails
 * closed; the translation-pairing gate reports the cross-language mismatch.
 *
 * @param blocks - Blocks in repository scan order.
 * @param docOf - Repository-relative Markdown path owning a block.
 * @param fingerprintOf - Block kind/info string plus byte-exact body.
 * @returns Primary blocks and paired Chinese derivatives, preserving order.
 */
export function partitionPairedMarkdownDerivatives<T>(
  blocks: readonly T[],
  docOf: (block: T) => string,
  fingerprintOf: (block: T) => string,
): MarkdownDerivativePartition<T> {
  const byDoc = new Map<string, T[]>()
  for (const block of blocks) {
    const doc = docOf(block)
    const group = byDoc.get(doc)
    if (group) group.push(block)
    else byDoc.set(doc, [block])
  }

  const derivativeDocs = new Set<string>()
  for (const [doc, candidates] of byDoc) {
    const sibling = unsuffixedSibling(doc)
    if (sibling === null) continue
    const originals = byDoc.get(sibling)
    if (originals === undefined || originals.length !== candidates.length) continue
    if (candidates.every((candidate, index) => {
      const original = originals[index]
      return original !== undefined && fingerprintOf(candidate) === fingerprintOf(original)
    })) {
      derivativeDocs.add(doc)
    }
  }

  const primary: T[] = []
  const derivatives: T[] = []
  for (const block of blocks) {
    (derivativeDocs.has(docOf(block)) ? derivatives : primary).push(block)
  }
  return { primary, derivatives }
}
