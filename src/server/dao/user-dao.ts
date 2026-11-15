export type UserRecord = {
  id: string
  name: string
  email: string
  createdAt: string
}

/**
 * Read access to the Users Better Auth keeps. Creating a User goes through
 * Better Auth itself, which owns its tables and its password hashing.
 */
export interface UserDao {
  list(): Promise<UserRecord[]>
  findById(id: string): Promise<UserRecord | null>
  findByNameOrEmail(value: string): Promise<UserRecord[]>
}
