#!/usr/bin/env node
/**
 * Generic JSON-RPC agent bin. External configurations own their bare plugin
 * packages; the packaged runtime uses `packaged-bin.ts` instead.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/bin
 */

import { runJsonrpcAgent } from './runner.ts'

await runJsonrpcAgent()
