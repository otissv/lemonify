import type { UserDao, UserRecord } from '../user-dao.ts'

/** An in-memory UserDao for tests of the rules that need Users. */
export class MemoryUserDao implements UserDao {
  readonly #users: UserRecord[] = []

  add(user: UserRecord): void {
    this.#users.push(user)
  }

  async list(): Promise<UserRecord[]> {
    return [...this.#users].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.#users.find((user) => user.id === id) ?? null
  }

  async findByNameOrEmail(value: string): Promise<UserRecord[]> {
    const matches = this.#users.filter(
      (user) => user.name === value || user.email === value,
    )
    return matches.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
  }
}
