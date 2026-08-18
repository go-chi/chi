/** Generate model-visible Host/Client Service and Event inspect catalogs. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { projectCordisCatalog } from '@deepseek-ai/dsh-typert-generator'
import type { CordisCatalogModel, ServiceMethodEntry } from '@deepseek-ai/dsh-typert-generator'
import { CORDIS_CATALOG_POLICY } from './gen-cordis-catalog.ts'

const root = resolve(import.meta.dirname, '..')
const CLIENT_OUT = 'packages/extensions/cordis-client-runner/src/client/api-catalog.ts'

const CLIENT_SERVICES: Readonly<Record<string, readonly string[]>> = {
  layout: ['toggleSidebar', 'openDetails', 'closeDetails'],
  locale: ['getLocale', 'getSnapshot', 'subscribe', 'setLocale', 'register', 'bind'],
  sessions: ['open', 'openSubagent', 'setSubagentCatalogOpen', 'refreshSubagents', 'search', 'fork', 'scope', 'binding'],
  slots: ['register', 'inject'],
  theme: ['getTheme', 'setTheme', 'register', 'overrideTokens'],
  workspaces: [
    'connectWorkspace', 'startSession', 'create', 'pickDirectory', 'listDirectory', 'createDirectory',
    'openPath', 'rename', 'delete', 'insertSessionBefore', 'archiveSession',
  ],
}

const CLIENT_EVENTS = new Set([
  'connection/reset',
  'locale/change',
  'slots/changed',
  'theme/change',
])

function methodName(method: ServiceMethodEntry): string | undefined {
  return /^(?:declare\s+)?(?:readonly\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)/.exec(method.signature)?.[1]
}

function clientModel(model: CordisCatalogModel): CordisCatalogModel {
  return {
    services: model.services.flatMap((service) => {
      const allowed = CLIENT_SERVICES[service.key]
      if (allowed === undefined) return []
      const names = new Set(allowed)
      return [{ ...service, methods: service.methods.filter(method => names.has(methodName(method) ?? '')) }]
    }),
    events: model.events.filter(event => CLIENT_EVENTS.has(event.name)),
  }
}

function main(): void {
  const { projector, model } = projectCordisCatalog(root, CORDIS_CATALOG_POLICY, 'client')
  const destination = resolve(root, CLIENT_OUT)
  const source = projector.renderRuntimeApi(clientModel(model))
    .replaceAll('@deepseek-ai/dsh-tool-cordis/api-catalog', '@deepseek-ai/dsh-cordis-client-runner/client/api-catalog')
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, source)
  console.log(`gen-cordis-inspect-catalog: wrote ${CLIENT_OUT}`)
}

main()
