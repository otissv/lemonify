import { describe, expect, it } from 'vitest'

import { MemoryUserDao } from '../dao/memory/user-dao'
import { NotFoundError, ValidationError } from '../errors'
import { LOCAL_USER, UserService } from './user-service'

function setup() {
  const users = new MemoryUserDao()
  const signUps: Array<{ name: string; email: string; password: string }> = []
  const auth = {
    async signUp(account: { name: string; email: string; password: string }) {
      signUps.push(account)
      const id = `user-${signUps.length}`
      users.add({
        id,
        name: account.name,
        email: account.email,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      return { userId: id }
    },
  }
  return { users, signUps, service: new UserService({ users, auth }) }
}

function addUser(users: MemoryUserDao, id: string, name: string): void {
  users.add({
    id,
    name,
    email: `${id}@example.com`,
    createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
  })
}

describe('UserService.resolveActor', () => {
  it('creates one local User when there are no Users, with a password nobody sees', async () => {
    const { service, signUps } = setup()
    const actor = await service.resolveActor()
    expect(actor).toEqual({ userId: 'user-1', name: LOCAL_USER.name })
    expect(signUps).toHaveLength(1)
    expect(signUps[0]?.email).toBe(LOCAL_USER.email)
    expect(signUps[0]?.password).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reuses the local User on the next call instead of creating another', async () => {
    const { service, signUps } = setup()
    const first = await service.resolveActor()
    const second = await service.resolveActor()
    expect(second).toEqual(first)
    expect(signUps).toHaveLength(1)
  })

  it('acts as the only User', async () => {
    const { service, users, signUps } = setup()
    addUser(users, 'a', 'Ann')
    expect(await service.resolveActor()).toEqual({ userId: 'a', name: 'Ann' })
    expect(signUps).toHaveLength(0)
  })

  it('refuses to guess between several Users', async () => {
    const { service, users } = setup()
    addUser(users, 'a', 'Ann')
    addUser(users, 'bb', 'Bea')
    await expect(service.resolveActor()).rejects.toThrow(ValidationError)
    await expect(service.resolveActor()).rejects.toThrow(/--user/)
  })

  it('finds a User by name or email', async () => {
    const { service, users } = setup()
    addUser(users, 'a', 'Ann')
    addUser(users, 'bb', 'Bea')
    expect(await service.resolveActor('Bea')).toEqual({
      userId: 'bb',
      name: 'Bea',
    })
    expect(await service.resolveActor('a@example.com')).toEqual({
      userId: 'a',
      name: 'Ann',
    })
  })

  it('says so when the named User does not exist', async () => {
    const { service } = setup()
    await expect(service.resolveActor('Nobody')).rejects.toThrow(NotFoundError)
  })

  it('asks for the email when a name is shared', async () => {
    const { service, users } = setup()
    addUser(users, 'a', 'Ann')
    addUser(users, 'bb', 'Ann')
    await expect(service.resolveActor('Ann')).rejects.toThrow(/email/)
  })
})

describe('UserService.list', () => {
  it('lists the Users', async () => {
    const { service, users } = setup()
    addUser(users, 'a', 'Ann')
    expect((await service.list()).map((user) => user.name)).toEqual(['Ann'])
  })
})
