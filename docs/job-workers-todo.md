# Job workers to-do

A list of what needs doing, in build order, not a plan. It fixes the website stalling while images are processed: today the web server runs every job itself, so renders take the helper threads that file reads, uploads and sign-in need, and the CPU and main thread that requests need. Postgres replaces SQLite first (section 1), because separate worker processes write to the database often and at the same time, which SQLite handles worst. Every item is built test first, and `tsc`, `biome check .`, Vitest and the Playwright run pass at the end of each section.

## What was found

| Finding | Evidence |
| --- | --- |
| Renders starve the web server's helper threads | With 4 renders running, reading a tiny file took 1.2 s; with 8 queued, 2.4 s. Under load the e2e pages stayed on "Loading…" for over 30 s. |
| A database write that waits for another process freezes the waiting process | better-sqlite3 waits on the main thread: a write blocked for 2.9 s froze the event loop for 2.95 s. Real CLI commands held the lock for 2 ms at most, so it is rare today, but separate worker processes write often. |
| Three DAO methods rely on SQLite letting one writer in at a time | `lockedRow` in the document and workflow DAOs reads `revision`, checks it, then writes `revision + 1`; `finish` in the job DAO reads `cancel_requested`, then writes the outcome. Under Postgres's default isolation two transactions both pass the read: an undo (`moveCursor`) and an edit in another tab both save the same revision and the history no longer matches the pipeline; two edits at once (`applyChange`) end in a raw primary key error on `history_entries` instead of the stale document conflict; a cancel between the read and the write is missed, so a cancelled run queues its next segments. `claim` and `requestCancel` are single conditional updates and are already safe. |
| `e2e/api.spec.ts:265` fails on a repeat or retry | It always names its workflow "Api run": "A workflow with this name already exists." |

What already works across processes and is reused: the job queue is in the database, a job is claimed with one conditional update, jobs of a process that is gone are failed (`Scheduler.reapOrphans`), and a cancel is read from the database (`cancelRequested`).

## Decisions

| # | Short name | Decided |
| --- | --- | --- |
| 1 | Worker processes | The web server runs no jobs. It starts a fixed pool of worker processes with `child_process.fork`, restarts one that stops, and stops them all when it stops. |
| 2 | Pool shape | One CPU worker process per CPU slot (`LEMONIFY_CPU_WORKERS`, at most 4 by default), each running one job at a time; one GPU worker process that keeps the AI models loaded and batches AI jobs. |
| 3 | Work per image | Work is shared out per job (one per input image, or per segment of a run with AI steps), not per workflow, so one workflow spreads over every worker and the 50% rule (`LEMONIFY_GROUP_SHARE`) keeps runs fair. |
| 4 | Live updates | Every process that runs the core (the web server, each worker, each CLI command) sends what changed to the web server through one local socket in the data folder, readable only by the user who runs Lemonify. The web server tells the open tabs through `RealtimeHub`. When no web server is running there are no tabs, and the change is not sent. |
| 5 | Database waits | No process waits for the database on its main thread: the `pg` driver is asynchronous, so a wait for a lock is a pending promise, not a frozen event loop. No retry layer is built. Every connection sets `lock_timeout` and `statement_timeout`, so a wait ends with a clear error instead of hanging. |
| 6 | CLI | A CLI command does its jobs in its own process (`scripts/images/in-process-workers.ts`) only when no web server is running, so it still works on its own. When a web server is running (its socket answers), the command queues its jobs and the server's worker pool does them; the command waits for the results and prints them as it does now. However many agents run the CLI, the pool's worker count and the 50% rule (`LEMONIFY_GROUP_SHARE`) hold. |
| 7 | CLI and website | A change made with the CLI reaches open tabs like one made on the website, because the core announces it through the channel of decision 4 (live updates), whichever process it runs in. |
| 8 | GPU worker start | The GPU worker starts only when an AI job is queued, which needs an AI tool set up, and stops after it has been idle for a while, so no models are loaded and no GPU memory is held when no document or workflow uses AI. |
| 9 | Postgres | Postgres replaces SQLite for Lemonify's tables and Better Auth's. Lemonify is a web server on one machine, so Postgres runs beside it (or as a managed database), and the CLI reaches it through the same connection string. Knex uses the `pg` client with a pool. The SQLite DAOs, `better-sqlite3` and `@types/better-sqlite3` are removed, with no SQLite fallback; `LEMONIFY_DATABASE` and `databaseFile` go, and `LEMONIFY_DATABASE_URL` (required) takes their place. |
| 10 | No data migration | Nothing is in production and there are no users, so no data is copied from SQLite. The 12 SQLite migrations are replaced by one starting migration that creates today's schema, and the tests of the data rewrites in those migrations go with them because the rewrites no longer exist. `.data/lemonify.sqlite` is deleted once. |
| 11 | Column types | JSON columns are `jsonb` and still validated by their Zod schemas on read; flags (`cancel_requested`) are `boolean`; times are `timestamptz`, turned into UTC ISO strings in the DAOs, so the DAO interfaces and services do not change. Better Auth's tables are what its `generate` command makes for Postgres. |
| 12 | Row locks | `lockedRow` (document and workflow DAOs) and the read in `finish` (job DAO) take the row with `FOR UPDATE`, so a second transaction on the same row waits for the first and then sees its result: a stale revision becomes the stale document or workflow conflict, and a cancel is never missed. |
| 13 | Local Postgres | Development runs Postgres 18 in a container from `compose.yaml` in the repository, bound to `127.0.0.1`, with its data in a named volume. Production uses the same major version. |
| 14 | Test databases | DAO tests and the e2e run use a real Postgres, because PGlite has one connection and cannot run the two-transaction tests that decision 12 (row locks) needs. Each test file gets its own database, copied from a migrated template database (`CREATE DATABASE … TEMPLATE`), and drops it at the end, so files stay isolated and run in parallel. Services keep their in-memory DAO fakes and need no database. |

## 1. Postgres (decisions 5, database waits; 9, Postgres; 10, no data migration; 11, column types; 12, row locks; 13, local Postgres; 14, test databases)

- [ ] `compose.yaml` with Postgres 18 (decision 13, local Postgres) and a README section on starting it and setting `LEMONIFY_DATABASE_URL`.
- [ ] Config: `LEMONIFY_DATABASE_URL` is required and validated by the config schema, with a message naming it when missing; `LEMONIFY_DATABASE` and `databaseFile` are removed; config tests say so.
- [ ] `src/server/database/connection.ts` opens Knex with the `pg` client and a pool, sets `lock_timeout` and `statement_timeout` on each connection (decision 5, database waits), and reads `timestamptz` and `bigint` the way the DAOs expect. `applyPragmas` is removed.
- [ ] One starting migration with today's schema, constraints and indexes (decision 10, no data migration; decision 11, column types), including Better Auth's Postgres tables; the 12 SQLite migrations and `document-order-migration.test.ts`, `layers-migration.test.ts`, `layers-only-migration.test.ts`, `open-image-steps-migration.test.ts` and `workflow-canvas-size-migration.test.ts` are deleted; `migrate.test.ts` checks the Postgres schema and that Better Auth has nothing left to create.
- [ ] The DAOs move from `src/server/dao/sqlite/` to `src/server/dao/postgres/` as Postgres classes: `jsonb` columns without `JSON.stringify`, flags as booleans, times as ISO strings. The contract tests in `src/server/dao/contract/` pass against them unchanged.
- [ ] Row locks (decision 12, row locks), each with a test that runs two transactions at once: an undo and an edit of the same revision leave one saved and one conflict, with the history matching the pipeline; two edits of the same revision give one stale document conflict, not a database error; the same for workflows; a cancel requested while `finish` runs queues no next segments.
- [ ] Better Auth uses a `pg` pool on `LEMONIFY_DATABASE_URL`; the auth gateway tests pass.
- [ ] Test databases (decision 14, test databases): `createTestDatabase` gives each test file its own database from the migrated template and drops it after; `insertTestUser` writes Better Auth's Postgres row.
- [ ] The e2e server uses its own database, recreated from empty at the start of each run as `e2e/.data` is today.
- [ ] The CLI connects with `LEMONIFY_DATABASE_URL` and, when Postgres cannot be reached, fails with a JSON error that says so.
- [ ] `pg` added; `better-sqlite3` and `@types/better-sqlite3` removed; `.data/lemonify.sqlite` deleted once.

## 2. Tests that fail today

- [ ] Fix `e2e/api.spec.ts:265` to name its workflow with `uniqueName(testInfo, …)`.
- [ ] An integration test: while another connection holds a row lock on a document, the web server still answers a request within 100 ms (decision 5, database waits).
- [ ] An integration test: while the CPU workers are full of long renders, the web server reads a file and answers a request within 100 ms (decision 1, worker processes).

## 3. The worker process (decisions 2, pool shape; 3, work per image)

- [ ] A worker entry (`src/server/worker/`) that composes the services a job needs, without the web server, the realtime server or auth, and runs a scheduler for one pool (CPU or GPU) with one job at a time for a CPU worker.
- [ ] Its helper thread pool is sized for its work in the `fork` environment (`UV_THREADPOOL_SIZE`), set before the process starts.
- [ ] Its database pool is small (one or two connections), so the total of every process's pool stays inside Postgres's connection limit.
- [ ] Tests: a worker takes a job from the queue, runs it, records its result and finishes it; two workers never take the same job; a cancel stops a job in a worker.

## 4. The channel from the core to the web server (decisions 4, live updates; 7, CLI and website)

- [ ] A message schema (zod) for what a process sends: realtime events, job progress, and that a worker is ready or stopping. Messages that fail the schema are logged and dropped.
- [ ] The web server listens on a local socket in the data folder, created readable only by its user, removed when the server stops, and replaced when a stale one is found at start.
- [ ] A `ChangePublisher` for every process that is not the web server (workers and the CLI): it sends over the socket, and does nothing when no server is listening, without slowing the command.
- [ ] The receiver in the web server passes events to `RealtimeHub`.
- [ ] Tests: a result made in a worker reaches the owner's open tabs (`picture.changed`, job progress and finish); an edit made with the CLI reaches them; several CLI processes at once all reach them; a bad message changes nothing; a CLI command with no server running finishes as fast as before.

## 5. The pool in the web server (decisions 1, worker processes; 2, pool shape)

- [ ] A supervisor that starts the CPU workers, starts the GPU worker when an AI job is queued and stops it after it has been idle (decision 8, GPU worker start), restarts a worker that stops with a growing delay, and stops them all, letting running jobs finish, when the server stops.
- [ ] The web server no longer starts its own scheduler; a job queued on the website wakes a free worker.
- [ ] A job left running by a worker that stopped is failed with the existing orphan message (`reapOrphans`), and the owner's tabs are told.
- [ ] `LEMONIFY_CPU_WORKERS` and `LEMONIFY_GPU_WORKERS` now count processes; config tests and messages say so.
- [ ] Tests: the pool starts the right number of workers, restarts one that is killed, and stops cleanly; a killed worker's job is failed and the next job runs.

## 6. The CLI (decisions 6, CLI; 7, CLI and website)

- [ ] A CLI command that queues jobs checks whether a web server is running (its socket answers). If it is, the command leaves the jobs to the server's pool and waits for their results; if not, it does them in its own process as today.
- [ ] Tests: with a server running, a CLI command's jobs are done by the pool and the command prints the same results; with no server, the command does them itself; several CLI commands at once never run more jobs than the pool allows.

## 7. Docs

- [ ] `docs/editor-pipeline-plan.md` or a new architecture note: Postgres and why (decision 9, Postgres), the web server, the worker pool, the channel, the database waits and why (the findings above). The SQLite statements in `docs/editor-pipeline-plan.md` (Standalone, Storage, Authentication, the driver, several databases, concurrent writers, the database section and the `LEMONIFY_DATA_DIR` and `LEMONIFY_DATABASE` settings) and the store column of `docs/glossary.md` are updated.
- [ ] README and `docs/` configuration: `LEMONIFY_DATABASE_URL`, starting Postgres with `compose.yaml`, and what `LEMONIFY_CPU_WORKERS` and `LEMONIFY_GPU_WORKERS` now mean.

## 8. Done when

- [ ] Vitest, `tsc`, `biome check .`, `pnpm build` and the Playwright run all pass.
- [ ] The stress run passes: `npx playwright test e2e/api.spec.ts e2e/workflow-editing.spec.ts e2e/workflow-run-actions.spec.ts --repeat-each 4 --workers 8`.
- [ ] During a run of 8 large images, the website answers pages, images and sign-in without waiting for the run.
