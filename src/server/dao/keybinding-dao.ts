import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'

export type KeybindingRecord = {
  ownerId: string
  /** Only what the User changed from the defaults. */
  overrides: KeybindingsFile
  updatedAt: string
}

/** Where each User's changed key bindings are kept: at most one record per User. */
export interface KeybindingDao {
  findByOwner(ownerId: string): Promise<KeybindingRecord | null>
  /** Creates the record or replaces it whole. */
  save(record: KeybindingRecord): Promise<void>
  /** Removes the record; a User with none has no changes. */
  deleteByOwner(ownerId: string): Promise<void>
}
