import { Service } from '@deepseek-ai/cordis'
import type HostDefault from '@fixture/host'
import type * as Host from '@fixture/host'
import type { AgentPhase } from '@fixture/host'
import type { HostAgent, Payload } from '@fixture/host'

export type { Box as ReexportedBox } from '@fixture/host'
export type { ZodType as ReexportedZodType } from 'zod'

/** Client-owned inheritance preserves an explicit generic cross-face edge. */
export interface ClientAgent extends HostAgent<{ ready: true }> {}

/** Client-owned view with explicit references to host exports. */
export interface ClientView {
  readonly agent: HostAgent<{ ready: true }>
  readonly inherited: ClientAgent
  readonly importedAgent: import('@fixture/host').Agent<{ ready: true }>
  readonly importedAgentWithNamedArgument: import('@fixture/host').Agent<Payload>
  readonly namespaceAgent: Host.Agent<{ ready: true }>
  readonly defaultService: HostDefault
  readonly payload: Payload
  readonly phase: AgentPhase
}

/** Client-face service. */
export class ClientBridge extends Service {
  /** Return the host-owned object unchanged. */
  reflect(view: ClientView): HostAgent<{ ready: true }> {
    return view.agent
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    clientBridge: ClientBridge
  }
}

export default ClientBridge
