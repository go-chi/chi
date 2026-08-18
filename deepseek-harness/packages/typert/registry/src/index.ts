/** Host entry for the shared Typert runtime registry. */

import type { z } from 'zod'
import type { TypertDisposer } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TypertContribution,
  TypertFace,
  TypertPackageFilter,
  TypertPackageRecord,
  TypertSchemaFilter,
  TypertSchemaRecord,
} from './types.ts'

export { default, TypertRegistry, typertEndpoint, typertKey, typertPackageKey } from './service.ts'
export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRegistryContract {
    register(contribution: TypertContribution): TypertDisposer
    get(key: string): TypertSchemaRecord | undefined
    resolve(key: string): TypertSchemaRecord
    list(filter?: TypertSchemaFilter): TypertSchemaRecord[]
    getPackage(packageName: string, face?: TypertFace): TypertPackageRecord | undefined
    listPackages(filter?: TypertPackageFilter): TypertPackageRecord[]
    toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
  }
}
