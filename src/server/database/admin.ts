import pg from 'pg'

import type { DatabaseConfig } from '../config/config.ts'
import { connectionSettings } from './connection.ts'

/** The database every Postgres server has; databases are created and dropped from it. */
const MAINTENANCE_DATABASE = 'postgres'

async function onServer<T>(
  server: DatabaseConfig,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client(
    connectionSettings({ ...server, database: MAINTENANCE_DATABASE }),
  )
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

/** Creates an empty database on the server, or a copy of `template`. */
export async function createDatabase(
  server: DatabaseConfig,
  name: string,
  template?: string,
): Promise<void> {
  await onServer(server, (client) => {
    const copy =
      template === undefined
        ? ''
        : ` template ${client.escapeIdentifier(template)}`
    return client.query(
      `create database ${client.escapeIdentifier(name)}${copy}`,
    )
  })
}

/** Drops the database if it is there, closing any connections to it first. */
export async function dropDatabase(
  server: DatabaseConfig,
  name: string,
): Promise<void> {
  await onServer(server, (client) =>
    client.query(
      `drop database if exists ${client.escapeIdentifier(name)} with (force)`,
    ),
  )
}

/** The names of the server's databases that start with `prefix`. */
export async function databasesStartingWith(
  server: DatabaseConfig,
  prefix: string,
): Promise<string[]> {
  return onServer(server, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'select datname from pg_database where starts_with(datname, $1)',
      [prefix],
    )
    return rows.map((row) => row.datname)
  })
}
