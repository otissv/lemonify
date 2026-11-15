import type { Knex } from 'knex'

import type { UserDao, UserRecord } from '../user-dao.ts'

type UserRow = {
  id: string
  name: string
  email: string
  createdAt: string | number
}

const COLUMNS = ['id', 'name', 'email', 'createdAt'] as const

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

export class SqliteUserDao implements UserDao {
  readonly #database: Knex

  constructor(database: Knex) {
    this.#database = database
  }

  async list(): Promise<UserRecord[]> {
    const rows: UserRow[] = await this.#database('user')
      .select(COLUMNS)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row: UserRow | undefined = await this.#database('user')
      .select(COLUMNS)
      .where({ id })
      .first()
    return row === undefined ? null : toRecord(row)
  }

  async findByNameOrEmail(value: string): Promise<UserRecord[]> {
    const rows: UserRow[] = await this.#database('user')
      .select(COLUMNS)
      .where({ name: value })
      .orWhere({ email: value })
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
    return rows.map(toRecord)
  }
}
