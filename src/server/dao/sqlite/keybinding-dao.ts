import type { Knex } from 'knex'

import { readStoredKeybindings } from '@/features/keybindings/keybindings-file'

import type { KeybindingsFile } from '@/features/keybindings/keybindings-file'

import { DataIntegrityError } from '../../errors.ts'
import type { KeybindingDao, KeybindingRecord } from '../keybinding-dao.ts'

type KeybindingRow = {
  owner_id: string
  bindings: string
  updated_at: string
}

const UNREADABLE = 'Saved key bindings could not be read.'

function toRecord(row: KeybindingRow): KeybindingRecord {
  let json: unknown
  try {
    json = JSON.parse(row.bindings)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE, { cause: error })
  }
  let overrides: KeybindingsFile
  try {
    overrides = readStoredKeybindings(json)
  } catch (error) {
    throw new DataIntegrityError(UNREADABLE, { cause: error })
  }
  return {
    ownerId: row.owner_id,
    overrides,
    updatedAt: row.updated_at,
  }
}

export class SqliteKeybindingDao implements KeybindingDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  async findByOwner(ownerId: string): Promise<KeybindingRecord | null> {
    const row: KeybindingRow | undefined = await this.#database('keybindings')
      .where({ owner_id: ownerId })
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async save(record: KeybindingRecord): Promise<void> {
    await this.#database('keybindings')
      .insert({
        owner_id: record.ownerId,
        bindings: JSON.stringify(record.overrides),
        updated_at: record.updatedAt,
      })
      .onConflict('owner_id')
      .merge()
  }

  async deleteByOwner(ownerId: string): Promise<void> {
    await this.#database('keybindings').where({ owner_id: ownerId }).delete()
  }
}
