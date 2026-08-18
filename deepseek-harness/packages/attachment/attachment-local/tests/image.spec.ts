import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { detectImage, probeImage } from '../src/image.ts'

async function raster(format: 'png' | 'jpeg' | 'webp' | 'gif'): Promise<Uint8Array> {
  const image = sharp({
    create: { width: 3, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
  return new Uint8Array(await image.toFormat(format).toBuffer())
}

describe('raster decoding', () => {
  it('decodes every supported format and its intrinsic dimensions', async () => {
    for (const [format, mediaType] of [
      ['png', 'image/png'],
      ['jpeg', 'image/jpeg'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
    ] as const) {
      await expect(detectImage(await raster(format)))
        .resolves.toEqual({ mediaType, width: 3, height: 2 })
    }
  })

  it('rejects excess decoded pixels before decoding', async () => {
    await expect(detectImage(await raster('png'), 5))
      .rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS' })
  })

  it('rejects malformed bytes and truncated payloads with readable headers', async () => {
    await expect(detectImage(Uint8Array.of(1, 2, 3)))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const unsupported = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).tiff().toBuffer()
    await expect(detectImage(unsupported)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const complete = await raster('png')
    const truncated = complete.subarray(0, 62)
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({ width: 3, height: 2 })
    await expect(detectImage(truncated)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
  })

  it('probes malformed bytes and unsupported formats into the same stable error', async () => {
    await expect(probeImage(Uint8Array.of(1, 2, 3)))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    const unsupported = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    }).tiff().toBuffer()
    await expect(probeImage(unsupported)).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
  })
})
