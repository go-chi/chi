/**
 * Named backend registry of the storage hub.
 * @module @deepseek-ai/dsh-storage/src/registry
 */

import type { StorageBackend } from './backend.ts'
import { StorageError } from './error.ts'

/**
 * Mutable name → backend table. Multiple backends stay mounted side by side;
 * which backend serves which consumer is the consumer's configuration
 * (e.g. the domain layer's route table), never a hub-global choice.
 */
export class BackendRegistry {
  private readonly backends = new Map<string, StorageBackend>()

  /**
   * Register a named backend. Registration is an effect: the returned
   * disposer removes the name. Disposal does NOT close the backend — the
   * owning plugin closes it after unregistering.
   * @param name - Backend name, e.g. `json` or `sqlite`.
   * @param backend - The backend instance.
   * @returns the disposer that unregisters the name.
   */
  register(name: string, backend: StorageBackend): () => void {
    if (this.backends.has(name)) {
      throw new StorageError('duplicate-backend', `storage backend '${name}' is already registered`)
    }
    this.backends.set(name, backend)
    return () => {
      // Remove only this registration's contribution: after dispose + re-register,
      // a stale disposer firing again must not remove the successor.
      if (this.backends.get(name) === backend) {
        this.backends.delete(name)
      }
    }
  }

  /**
   * Resolve a backend by name.
   * @param name - Registered backend name.
   * @returns the backend.
   */
  get(name: string): StorageBackend {
    const backend = this.backends.get(name)
    if (!backend) {
      throw new StorageError(
        'backend-not-found',
        `storage backend '${name}' is not registered (registered: ${[...this.backends.keys()].join(', ') || 'none'})`,
      )
    }
    return backend
  }

  /**
   * Registered backend names, for diagnostics.
   * @returns a snapshot array of names.
   */
  names(): string[] {
    return [...this.backends.keys()]
  }
}
