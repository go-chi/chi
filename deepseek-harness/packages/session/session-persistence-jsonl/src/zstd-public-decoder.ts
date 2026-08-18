/**
 * Public-API synchronous Zstandard frame decoder fallback.
 * @module dsh-session-persistence-jsonl/zstd-public-decoder
 */

import { zstdDecompressSync } from 'node:zlib'
import type { ZstdFrameDecoder, ZstdFrameRange } from './zstd.ts'

/** Multi-frame adapter built exclusively from Node's supported one-shot API. */
export class PublicZstdFrameDecoder implements ZstdFrameDecoder {
  private started = false
  private closed = false

  /** @inheritdoc */
  public *decode(source: Buffer, frames: readonly ZstdFrameRange[]): Generator<Buffer, void, void> {
    if (this.started) throw new Error('Zstandard frame decoder was already started')
    if (this.closed) throw new Error('cannot start a closed Zstandard frame decoder')
    this.started = true
    try {
      for (const { start, end } of frames) {
        let decoded: Buffer
        try {
          decoded = zstdDecompressSync(source.subarray(start, end))
        } catch (error) {
          throw new Error(`corrupt Zstandard session log: frame at byte ${start} failed validation`, {
            cause: error,
          })
        }
        yield decoded
      }
    } finally {
      this.close()
    }
  }

  /** @inheritdoc */
  close(): void {
    this.closed = true
  }
}
