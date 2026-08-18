/**
 * Spawn-only worker entrypoint over {@link runWorkerMain}. Executable logic stays in
 * `bootstrap.ts` for in-process coverage; real-worker tests cover this glue.
 * @module @deepseek-ai/dsh-code-runtime-worker-thread/src/worker
 */

import { parentPort, workerData } from 'node:worker_threads'
import { runWorkerMain } from './bootstrap.ts'
import type { WorkerBootData } from './protocol.ts'

// A worker always has a parent port; guard loudly rather than run detached.
if (!parentPort) throw new Error('dsh-code-runtime-worker-thread: worker entry loaded outside a worker thread')

void runWorkerMain(parentPort, workerData as WorkerBootData, { stdout: process.stdout, stderr: process.stderr })
