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
