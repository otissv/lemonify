/**
 * Run by plain Node (see composition.test.ts) to prove the composition file
 * loads without Vite: the `@/` alias and the enums in the schemas it imports
 * are handled by the CLI's loader and flag.
 */
import { loadConfig } from '../config/config.ts'
import { readEnvironment } from '../config/environment.ts'
import { createApp } from '../composition.ts'

const config = loadConfig(readEnvironment())
const app = await createApp(config)
const tables = await app
  .database('information_schema.tables')
  .where({ table_schema: config.database.schema })
  .count({ count: '*' })
console.log(JSON.stringify({ tables: tables[0]?.count }))
await app.close()
