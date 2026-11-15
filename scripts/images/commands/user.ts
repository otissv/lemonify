import { z } from 'zod'

import { parseWithSchema } from '../../../src/lib/images/validation.ts'
import type { UserRecord } from '../../../src/server/dao/user-dao.ts'
import { withApp } from '../app-session.ts'
import { PROGRAM, defineCommand, parseCliArgs } from '../cli.ts'
import type { ArgsOptions, ParsedCommand } from '../cli.ts'

const USAGE = `Usage: ${PROGRAM} user list

Lists the users, so --user <name> can name one. Users sign up on the website;
the CLI never creates a user, except the one local user on a machine that has
none.

Options:
  -h, --help           Show this help`

const ARGS = {
  allowPositionals: false,
  strict: true,
  options: { help: { type: 'boolean', short: 'h' } },
} as const satisfies ArgsOptions

const userListOptionsSchema = z.strictObject({})
type UserListOptions = z.output<typeof userListOptionsSchema>

function parse(argv: readonly string[]): ParsedCommand<UserListOptions> {
  const { values } = parseCliArgs(ARGS, argv, USAGE)
  if (values.help) return { kind: 'help' }
  return { kind: 'run', options: parseWithSchema(userListOptionsSchema, {}) }
}

async function run(): Promise<{ users: UserRecord[] }> {
  return withApp(async (app) => ({ users: await app.users.list() }))
}

function format({ users }: { users: UserRecord[] }): string {
  if (users.length === 0) return 'There are no users yet.'
  return users.map((user) => `${user.name}  ${user.email}`).join('\n')
}

export const userListCommand = defineCommand({
  name: 'user list',
  summary: 'List the users',
  usage: USAGE,
  schema: userListOptionsSchema,
  parse,
  run,
  format,
})
