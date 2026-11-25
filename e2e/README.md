# End-to-end tests

These tests open the real editor in a browser and compare what it shows with snapshots that were checked by eye. They run against a development server of their own on port 3200 with an empty data directory (`e2e/.data`), so they never touch your data.

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

## A fast, quiet server

Global setup opens the home page and a document once before the specs start, so the development server has compiled those pages and the first specs do not wait past their timeouts. `vite.config.ts` does not watch `e2e/.data`, `e2e/.run`, `.data` or `.claude`, which are written to all the time during a run.
