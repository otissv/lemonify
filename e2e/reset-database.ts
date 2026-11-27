/**
 * Run before the end-to-end server starts (playwright.config.ts), so every run
 * begins with an empty database, as it begins with an empty data folder.
 */
import { E2E_DATABASE } from '../playwright.config.ts'
import { resetDatabase } from './database.ts'

await resetDatabase(E2E_DATABASE)
