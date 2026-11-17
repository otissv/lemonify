import type { KeybindingDao, KeybindingRecord } from '../keybinding-dao.ts'

export class MemoryKeybindingDao implements KeybindingDao {
  readonly #records = new Map<string, KeybindingRecord>()

  async findByOwner(ownerId: string): Promise<KeybindingRecord | null> {
    const found = this.#records.get(ownerId)
    return found === undefined ? null : structuredClone(found)
  }

  async save(record: KeybindingRecord): Promise<void> {
    this.#records.set(record.ownerId, structuredClone(record))
  }

  async deleteByOwner(ownerId: string): Promise<void> {
    this.#records.delete(ownerId)
  }
}
