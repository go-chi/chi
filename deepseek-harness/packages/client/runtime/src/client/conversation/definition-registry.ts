import { Service } from '@deepseek-ai/cordis'

/** Shared lifecycle and stable-entry storage for one Conversation Definition registry. */
export abstract class ConversationDefinitionRegistry<Definition> extends Service {
  protected readonly definitions = new Map<string, Definition>()
  private listeners = new Set<() => void>()
  private cached: readonly Definition[] = []

  /**
   * Return reference-stable Definitions in registration order.
   * @returns current Definitions.
   */
  entries(): readonly Definition[] {
    return this.cached
  }

  /**
   * Observe low-frequency registry changes.
   * @param listener - synchronous invalidation callback.
   * @returns unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Register one uniquely keyed Definition for the caller's lifetime.
   * @param key - registry-local unique key.
   * @param definition - contributed Definition.
   * @param duplicateMessage - error raised when the key is already owned.
   * @param effectName - Cordis effect diagnostic label.
   * @returns idempotent disposer.
   */
  protected registerDefinition(
    key: string,
    definition: Definition,
    duplicateMessage: string,
    effectName: string,
  ): () => void {
    if (this.definitions.has(key)) throw new Error(duplicateMessage)
    const owner = this.ctx
    const dispose = owner.effect(() => {
      this.definitions.set(key, definition)
      this.refresh()
      return () => {
        if (this.definitions.get(key) !== definition) return
        this.definitions.delete(key)
        this.refresh()
      }
    }, effectName)
    return () => { void dispose() }
  }

  /** Refresh cached entries and synchronously invalidate subscribers. */
  protected refresh(): void {
    this.cached = [...this.definitions.values()]
    for (const listener of this.listeners) listener()
  }
}
