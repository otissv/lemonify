# End-to-end tests

These tests open the real editor in a browser and compare what it shows with snapshots that were checked by eye. They build the app and run against a built server of their own (`vite preview`, port 3200), so they test what ships. That server has an empty data directory (`e2e/.data`), so they never touch your data.

```bash
pnpm e2e            # run everything and compare with the snapshots
pnpm e2e:update     # write new snapshots, replacing the ones that differ
```

## How it works

`playwright.config.ts` starts the server with the request limits loosened (`LEMONIFY_RATE_LIMIT_MULTIPLIER`), because one browser opening hundreds of documents would otherwise be rate limited. `e2e/global-setup.ts` signs a test account up, then `e2e/seed.ts` uploads four pictures drawn by `e2e/fixtures.ts` (a scene, a cut-out with transparency, an overlay and a mask) and builds one document for every case in `e2e/cases`. `e2e/tool-snapshots.spec.ts` opens each document, waits for the editor to show the finished render, fails on any error alert or step that was left out, and compares the picture at its own size with `e2e/snapshots/<case>.png`.

The picture is compared at its own size, not as scaled to the window, so a Resize or Scale that changes nothing is caught, and the tools panel that floats over the canvas cannot get into a snapshot.

## What the cases cover

`e2e/coverage.spec.ts` fails when a tool has no case, when a tool that can be blended is never blended, or when a blend mode, layer fit or layer anchor is unused, so adding a tool without a case is caught. Cases are plain data in `e2e/cases`: add one with `testCase(id, [tool(...)])` and run `pnpm e2e:update` to write its snapshot.

## Changing a snapshot

A snapshot that differs is either a bug or a change you meant. Run the failing case, open the actual and expected pictures that Playwright writes under `e2e/.run/results`, and only then update. Snapshots are drawn by this machine's Sharp and Chromium; if they differ on another machine, update them there rather than loosening the comparison.

## Workflows, on the website and the command line

The workflow specs cover every workflow feature on both front doors, since the website and the command line must do the same things. Each spec signs in as its own scratch account from `e2e/global-setup.ts`, so specs running side by side never see each other's workflows, and each test names its workflow with `uniqueName` because names are unique per account.

`e2e/workflow-editing.spec.ts` drives the workflow page as a person would: adding, setting up, moving, hiding and removing steps and groups; undo and redo from the Edit menu and the keys; the canvas size (matching each input image, or a size of its own); the Output settings and the file names they give; adding and taking out input images; the side panel's Preview and Runs tabs with View › Step preview and Run panel and their keys; the preview's zoom toolbar; and renaming, showing and deleting a workflow from the sidebar. `e2e/workflow-run-actions.spec.ts` covers the Runs tab: choosing images with search, Select all and Shift, a run in which one image fails and why, Retry failed, Run again, Delete and Stop. `e2e/workflow-runs.spec.ts` runs a workflow on an uploaded AVIF and downloads the results one by one and as a zip. `e2e/workflow-page.ts` holds the helpers these specs share.

`e2e/workflow-cli.spec.ts` runs `pnpm images` as its own process, the way a person or a script would, on a data folder of its own under `e2e/.run`, and goes through every `workflow` command in order: create, show, list, update (canvas size, input images), rename, undo, redo, preview, run (with `--follow`, `--out`, `--manifest` and `--sources`, and queued without `--follow`), runs, run show, results (into a folder and as a zip), cancel, run delete and delete, and the commands it must refuse with a failing exit code. `e2e/cli.ts` starts the command line from the `images` script in `package.json` and checks what it prints against schemas.

`e2e/workflow-parity.spec.ts` runs the command line on the test server's own data folder as the account the browser is signed in as, and checks that each front door sees what the other did: a workflow made on the command line opens on the website, a change made on the website is in `workflow show` and `workflow undo` takes it back, and a run started on either side is followed on the other.

## The API

`e2e/api.spec.ts` calls every route under `/api` over HTTP, as three callers: the owner, another signed-in User and someone not signed in. For each route it checks what the owner gets (status, content type, the bytes, the download name and the caching and security headers), that someone not signed in gets 401 and another User gets the same 404 as an address that does not exist, so ownership never leaks, and that requests the route cannot take are refused with 422: an upload of the wrong type, bytes that are not the type they claim, no file name, a document file that is not one, a run with nothing finished. Every failure must be `{ data: [], error }` with no stack trace, path or SQL in it. A method a route does not have gets 405 with an `Allow` header, and an address under `/api` that no route has gets 404, both in the same shape. The renders' addresses are read from the pages that ask for them, and the run, its results and a run that fails are made with the command line, so the spec needs no other way into the server.

## A fast, quiet server

`e2e/responsiveness.spec.ts` times the server: while one of its requests waits for a document row that another connection has locked, and while the CPU workers are busy with long renders, the slowest of ten requests for an image must be answered within 100 ms. It runs as its own Playwright project after every other spec, so no other spec's renders share the server while it measures. The render test is marked `test.fail` until the worker pool takes jobs out of the web server (`docs/job-workers-todo.md`, section 5); when that lands it starts passing, Playwright reports "expected to fail, but passed", and the mark comes off.

Global setup opens the home page and a document once before the specs start, so the development server has compiled those pages and the first specs do not wait past their timeouts. `vite.config.ts` does not watch `e2e/.data`, `e2e/.run`, `.data` or `.claude`, which are written to all the time during a run.
