/**
 * Schema/draft model layer for settings editors: rehydrate the wire's
 * serialized schemastery envelope, resolve nodes by settings path, validate
 * drafts, and edit them immutably by path. Editors render their own controls
 * (the Models page hand-writes its layout) on top of these helpers.
 * @module @deepseek-ai/dsh-client-schema-form
 */

export {
  deletePath, getPath, hasPath, nodeAtPath, rehydrateSchema, setPath, validateDraft,
} from './model.ts'
export type { SchemaNode } from './model.ts'
