import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { decodeWorkerJson } from '../src/worker-json.ts'

/**
 * Prove the unbuilt worker is a self-contained source closure. Copying it out
 * of the workspace makes any package runtime import fail even when local
 * `lib/` artifacts happen to exist.
 */
it('boots the source worker without workspace package outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-code-source-worker-'))
  let worker: Worker | undefined
  try {
    const files = ['worker.ts', 'bootstrap.ts', 'protocol.ts', 'worker-json.ts', 'output-json.ts']
    await Promise.all(files.map(async (file) => {
      await copyFile(new URL(`../src/${file}`, import.meta.url), join(directory, file))
    }))

    worker = new Worker(join(directory, 'worker.ts'), {
      workerData: { code: 'return { answer: 42 }', namespaces: [], maxOutputBytes: 65_536 },
      env: {},
      execArgv: [],
    })
    const message = await new Promise<unknown>((resolve, reject) => {
      worker?.once('message', resolve)
      worker?.once('error', reject)
    })

    expect(message).toMatchObject({ type: 'done' })
    const value = typeof message === 'object' && message !== null ? (message as { value?: unknown }).value : undefined
    expect(decodeWorkerJson(value)).toEqual({ answer: 42 })
  } finally {
    if (worker) await worker.terminate()
    await rm(directory, { recursive: true, force: true })
  }
})
