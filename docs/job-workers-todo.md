# Job workers to-do

A list of what needs doing, in build order, not a plan. It fixes the website stalling while images are processed: today the web server runs every job itself, so renders take the helper threads that file reads, uploads and sign-in need, and the CPU and main thread that requests need. Every item is built test first, and `tsc`, `biome check .`, Vitest and the Playwright run pass at the end of each section.

## What was found

| Finding                                                                     | Evidence                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renders starve the web server's helper threads                              | With 4 renders running, reading a tiny file took 1.2 s; with 8 queued, 2.4 s. Under load the e2e pages stayed on "Loading…" for over 30 s.                                                                            |
| A database write that waits for another process freezes the waiting process | better-sqlite3 waits on the main thread: a write blocked for 2.9 s froze the event loop for 2.95 s. Real CLI commands held the lock for 2 ms at most, so it is rare today, but separate worker processes write often. |
| `e2e/api.spec.ts:265` fails on a repeat or retry                            | It always names its workflow "Api run": "A workflow with this name already exists."                                                                                                                                   |

What already works across processes and is reused: the job queue is in the database, a job is claimed in a transaction, jobs of a process that is gone are failed (`Scheduler.reapOrphans`), and a cancel is read from the database (`cancelRequested`).

## Decisions

| #   | Short name       | Decided                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Worker processes | The web server runs no jobs. It starts a fixed pool of worker processes with `child_process.fork`, restarts one that stops, and stops them all when it stops.                                                                                                                                                                                                                                                                                               |
| 2   | Pool shape       | One CPU worker process per CPU slot (`LEMONIFY_CPU_WORKERS`, at most 4 by default), each running one job at a time; one GPU worker process that keeps the AI models loaded and batches AI jobs.                                                                                                                                                                                                                                                             |
| 3   | Work per image   | Work is shared out per job (one per input image, or per segment of a run with AI steps), not per workflow, so one workflow spreads over every worker and the 50% rule (`LEMONIFY_GROUP_SHARE`) keeps runs fair.                                                                                                                                                                                                                                             |
| 4   | Live updates     | Every process that runs the core (the web server, each worker, each CLI command) sends what changed to the web server through one local socket in the data folder, readable only by the user who runs Lemonify. The web server tells the open tabs through `RealtimeHub`. When no web server is running there are no tabs, and the change is not sent.                                                                                                      |
| 5   | Database waits   | No process waits for the database on its main thread. A busy database is retried after an asynchronous pause, and a write transaction takes its lock when it begins, so a retry never repeats half of one.                                                                                                                                                                                                                                                  |
| 6   | CLI              | A CLI command does its jobs in its own process (`scripts/images/in-process-workers.ts`) only when no web server is running, so it still works on its own. When a web server is running (its socket answers), the command queues its jobs and the server's worker pool does them; the command waits for the results and prints them as it does now. However many agents run the CLI, the pool's worker count and the 50% rule (`LEMONIFY_GROUP_SHARE`) hold. |
| 7   | CLI and website  | A change made with the CLI reaches open tabs like one made on the website, because the core announces it through the channel of decision 4 (live updates), whichever process it runs in.                                                                                                                                                                                                                                                                    |
| 8   | GPU worker start | The GPU worker starts only when an AI job is queued, which needs an AI tool set up, and stops after it has been idle for a while, so no models are loaded and no GPU memory is held when no document or workflow uses AI.                                                                                                                                                                                                                                   |

## 1. Tests that fail today

- [ ] Fix `e2e/api.spec.ts:265` to name its workflow with `uniqueName(testInfo, …)`.
- [ ] An integration test: while another process holds the database write lock, the web server still answers a request within 100 ms (decision 5, database waits).
- [ ] An integration test: while the CPU workers are full of long renders, the web server reads a file and answers a request within 100 ms (decision 1, worker processes).

## 2. Database waits that do not freeze (decision 5)

- [ ] `busy_timeout` 0 on every connection (`applyPragmas`, the auth gateway's connection), and an asynchronous retry with backoff on `SQLITE_BUSY` in the database layer, with a limit after which it fails with a clear error.
- [ ] Write transactions begin with `BEGIN IMMEDIATE`, so a busy database is met at the start and the whole transaction is retried; read-only work stays outside transactions.
- [ ] Tests: a retried write succeeds once the lock is free; a transaction is never half applied; the event loop keeps ticking during the wait.

## 3. The worker process (decisions 2, work per image)

- [ ] A worker entry (`src/server/worker/`) that composes the services a job needs, without the web server, the realtime server or auth, and runs a scheduler for one pool (CPU or GPU) with one job at a time for a CPU worker.
- [ ] Its helper thread pool is sized for its work in the `fork` environment (`UV_THREADPOOL_SIZE`), set before the process starts.
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

- [ ] `docs/editor-pipeline-plan.md` or a new architecture note: the web server, the worker pool, the channel, the database waits and why (the findings above).
- [ ] README and `docs/` configuration: what `LEMONIFY_CPU_WORKERS` and `LEMONIFY_GPU_WORKERS` now mean.

## 8. Done when

- [ ] Vitest, `tsc`, `biome check .`, `pnpm build` and the Playwright run all pass.
- [ ] The stress run passes: `npx playwright test e2e/api.spec.ts e2e/workflow-editing.spec.ts e2e/workflow-run-actions.spec.ts --repeat-each 4 --workers 8`.
- [ ] During a run of 8 large images, the website answers pages, images and sign-in without waiting for the run.
