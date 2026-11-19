# Lemonify

Lemonify is a command-line image toolkit with a web editor on top. The CLI is the product: it edits images with [Sharp](https://sharp.pixelplumbing.com/), upscales them with [Upscayl](https://upscayl.org/) on the GPU, and runs saved workflows. Every command takes a JSON job and prints JSON, so people at a terminal, scripts and AI agents all use it the same way. The web editor is an add-on that gives the same operations a visual interface, for people who would rather click than type.

## How it works

**Two front doors, one set of services.** The CLI and the website are separate ways in to the same services. Neither contains image or data rules of its own, so anything the editor can do the CLI can do, and the reverse.

| Layer       | Does                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI, API    | The two front doors. The API sits behind middleware that signs the caller in, checks the request and rate-limits it; the CLI acts as a named user. Each calls one service. |
| Services    | All the rules: who may touch what, editing a pipeline, undo history, planning a render, queueing and running jobs, running a workflow.                                     |
| Tools, DAOs | Tools do the image work (Sharp, Upscayl, the folder of uploaded images). DAOs are the only code that touches the database.                                                 |

Services depend on interfaces for tools and DAOs, never on a specific database or library. Changing the database means writing a new set of DAO classes; the services, the API and the CLI stay as they are. Ownership is checked inside the services, not in the API, because queued jobs and workflow runs have no web request at all.

**The CLI runs where the data is.** On a server, a person or agent signs in to the machine and runs `lemonify` there; on a developer's machine, that machine is the server. There is no network connection between a CLI and a server, so there are no API keys. The CLI and the web server on one machine share one database and one job queue.

**A job queue keeps the server fair.** Slow work (renders, upscales, exports, each image of a workflow run) is queued as a Job and run by worker pools: one for the CPU (Sharp) and one for the GPU (Upscayl), so a long upscale never blocks a preview. Waiting jobs are served in turn per image and per workflow run, so no single image or workflow can hog the server. Consecutive Sharp steps run as one pass, and images that share an upscale model are upscaled in one batch. Jobs survive a restart.

**Images are edited, never changed.** An uploaded image is kept as it was. What you do to it is a pipeline of steps (41 Sharp tools across geometry, filters and colour, plus AI tools, starting with upscale) that can be edited, reordered, switched off and undone. Previews and exports run the real pipeline, so what you see is what you export.

## Core ideas

These terms are used the same way in code and docs; the full list is in [docs/glossary.md](docs/glossary.md).

| Term         | Means                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Source**   | An image a user uploaded, stored as a plain file by its content hash and never modified.                              |
| **Document** | The editable thing: an owner, a Source, a pipeline of steps and an undo history, kept in SQLite.                      |
| **Render**   | A cheap image computed from a Document (a preview or thumbnail). A disposable cache.                                  |
| **Result**   | An image that cost real work or was asked for (an AI Step, an export, a run). Kept until deleted.                     |
| **Job**      | One piece of queued server work, with progress, that can be cancelled.                                                |
| **Workflow** | A reusable pipeline, with a canvas like a document's, that runs over many Sources, started and followed from the CLI. |

## Requirements

| Requirement                | Needed for      | Notes                                                                               |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Node.js 22.18 or newer     | Everything      | Developed on Node 24.                                                               |
| pnpm 10                    | Everything      | Install scripts of dependencies are blocked by default.                             |
| A GPU with a Vulkan driver | AI upscale only | Every other feature runs on the CPU. See [doc/cli.md](doc/cli.md) for driver setup. |

## Getting started

```bash
pnpm install
pnpm images --help
```

To run the web editor as well:

```bash
pnpm dev
```

The editor is served at `http://localhost:3100`. To build for production:

```bash
pnpm build
```

The full CLI guide, including every command, is in [doc/cli.md](doc/cli.md). An agent skill that teaches an agent to use the CLI is in `skills/images-cli/`.

## CLI commands

The stateless commands work on any image with no database or sign-in. The stateful ones act as a user (`--user <name>`, or `LEMONIFY_USER`, or the only user) on the data in `.data/`.

| Commands                                                                                                                                                                                          | Does                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `sharp`, `info`, `upscale`, `models`, `formats`, `schema`                                                                                                                                         | Process, inspect and upscale images; list models and formats; print a command's JSON Schema    |
| `user list`                                                                                                                                                                                       | List the users                                                                                 |
| `keys list`, `set`, `unset`, `reset`, `export`, `import`                                                                                                                                          | Show and change your key bindings                                                              |
| `source add`, `list`, `delete`                                                                                                                                                                    | Upload images as sources, list or delete them                                                  |
| `document create`, `canvas`, `list`, `show`, `preview`, `rename`, `move`, `delete`, `undo`, `redo`, `step add`, `remove`, `move`, `set`, `rename`, `enable`, `disable`, `group`, `ungroup`, `run` | Create and edit documents: a pipeline of steps, in groups and sub-documents, with undo history |
| `export <documentId> --out <path>`                                                                                                                                                                | Render a document at full size and write it                                                    |
| `document export <id> --out <path>`                                                                                                                                                               | Write the document itself (pipeline, images, AI results) to a `.lemon` file                    |
| `document import <file>`                                                                                                                                                                          | Make a new document from a `.lemon` file                                                       |
| `workflow create`, `show`, `list`, `update`, `rename`, `undo`, `redo`, `delete`, `run`, `results`, `runs`, `cancel`, `run delete`                                                                 | Save a workflow and run it over its sources                                                    |
| `result list`, `show`, `delete`, `save`, `clear-unused`                                                                                                                                           | Manage the images that cost work or were asked for                                             |
| `job list`, `show`, `cancel`                                                                                                                                                                      | Follow and cancel queued work                                                                  |
| `worker`                                                                                                                                                                                          | Take jobs from the queue until stopped                                                         |

`document preview <id> --out <path>` writes the picture the editor's canvas shows (`--original` for the image as opened, `--before-step <stepId>` for the picture that step acts on, which is what the editor shows while an `extract` step is selected and what its left, top, width and height are measured on, `--region x,y,w,h` for part of it as fractions from 0 to 1, `--width` to shrink it), and prints the picture's size in its own pixels, and every command that edits a document takes `--preview <path>` to write that picture after the change, so the CLI can see what it did. The file type follows the extension (`.webp`, `.png`, `.jpg`), and the result lists AI steps still waiting and steps left out of the picture.

A command that waits for its jobs (`export`, `workflow run --follow`) does the work in its own process, so no server or worker is needed. The web server also runs workers itself, so `worker` is only for doing queued work when no server is running.

## Configuration

Settings are environment variables named `LEMONIFY_*`, all optional: `LEMONIFY_DATA_DIR` (default `.data`), `LEMONIFY_CPU_WORKERS`, `LEMONIFY_GPU_WORKERS`, `LEMONIFY_MAX_UPLOAD_BYTES`, `LEMONIFY_MAX_BUNDLE_BYTES`, `LEMONIFY_MAX_RESULT_BYTES_PER_USER`, `LEMONIFY_BASE_URL`, `LEMONIFY_REALTIME_PORT`, `LEMONIFY_REALTIME_HOST`, `LEMONIFY_REALTIME_URL` (see [live updates](docs/live-updates.md)), `LEMONIFY_RESEND_API_KEY`, `LEMONIFY_EMAIL_FROM` (see [authentication](docs/authentication.md)) and others, defined in `src/server/config/config.ts`. Users sign up on the website; the CLI never creates one except the single local user on a machine that has none.

## Scripts

| Script                  | Does                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm images <command>` | Runs the image CLI, for example `pnpm images --help`                                     |
| `pnpm dev`              | Starts the web editor's dev server on port 3100                                          |
| `pnpm build`            | Builds for production                                                                    |
| `pnpm test`             | Runs the tests once (Vitest)                                                             |
| `pnpm e2e`              | Runs the browser tests against the snapshots in `e2e/` (Playwright; see `e2e/README.md`) |
| `pnpm typecheck`        | Runs `tsc --noEmit`                                                                      |
| `pnpm check`            | Lints and checks formatting with Biome                                                   |
| `pnpm format`           | Fixes lint and formatting with Biome                                                     |

Linting and formatting use [Biome](https://biomejs.dev/), configured in `biome.json`. Biome has no type-aware rules, so `pnpm typecheck` is the type check.

## Project layout

| Path                 | Holds                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/images/`    | The image CLI                                                                                                                                        |
| `src/lib/images/`    | The image logic (Sharp and Upscayl), shared by the CLI and the app                                                                                   |
| `src/server/`        | The services, DAOs, tools, job scheduler, composition file and HTTP middleware the CLI and the API both use                                          |
| `src/features/`      | The web editor by feature: documents, pipeline, tools, export, results, AI tools, workflows and more                                                 |
| `src/routes/`        | TanStack Router file-based routes, including the API routes (`/api/sources`, `/api/results`, renders)                                                |
| `migrations/`        | Knex migrations for the SQLite database                                                                                                              |
| `src/components/ui/` | Shared UI components ([shadcn/ui](https://ui.shadcn.com/)); add one with `pnpm dlx shadcn@latest add <component>`                                    |
| `src/store/`         | Client state (Zustand)                                                                                                                               |
| `skills/images-cli/` | The agent skill for the CLI                                                                                                                          |
| `doc/`               | CLI documentation, including the generated Sharp job reference                                                                                       |
| `docs/`              | Project design: the [glossary](docs/glossary.md), the [editor and server plan](docs/editor-pipeline-plan.md) and [key bindings](docs/keybindings.md) |
| `.data/`             | The SQLite database, uploaded sources, results, the render cache and work folders (not committed)                                                    |

The web editor is built with TanStack Start, React 19 and TypeScript. Its visual design is described in [DESIGN.md](DESIGN.md).
