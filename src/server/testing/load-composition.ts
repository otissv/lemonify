/**
 * Run by plain Node (see composition.test.ts) to prove the composition file
 * loads without Vite: the `@/` alias and the enums in the schemas it imports
 * are handled by the CLI's loader and flag.
 */
import { loadConfig } from '../config/config.ts'
import { createApp } from '../composition.ts'

const app = await createApp(loadConfig(process.env))
const tables = await app
  .database('sqlite_master')
  .where({ type: 'table' })
  .count({ count: '*' })
console.log(JSON.stringify({ tables: tables[0]?.count }))
await app.close()
