# To do: layers and workflow pipelines

A list of what needs doing, not a plan. Every item is built test first, and every feature gets its CLI command, its website control and its `parity.ts` entry in the same change (see `CLAUDE.md`). Nothing keeps old behaviour: no migration, no compatibility code, no `BUNDLE_VERSION` bump. An old `.lemon` file gets the ordinary validation error.

Out of scope: batch steps, input steps, and layer kinds other than `image`.

## Decisions already made

| Decision                    | Means                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit canvas             | A document stores its own width, height and background. Nothing derives the canvas from an image after creation.                                                           |
| Image layer                 | `layer` is renamed `image layer`. It may be empty, keeps all its settings and draws nothing until it has an image.                                                         |
| Layer kinds                 | A layer has a `kind`; `image` is the only one. A registry owns validation, image ownership, planning and sidebar display. No consumer checks for `image` directly.         |
| One placement definition    | Fit, scale, rotation, anchor, x, y, opacity and blend are defined once and reused by every layer kind and by groups.                                                       |
| Workflow is a pipeline      | A workflow stores the same step model as a document, including groups and sub-documents, plus its input slots and output settings. Empty image layers are the input slots. |
| Create from, not convert    | "New document from workflow", "New workflow from document", and the same for a group or sub-document. The source is never changed.                                         |
| Context rules per step kind | A step kind says where it may appear and how it behaves there. The differences between a document and a workflow live in the create-from functions, not in the pipeline.   |
| Workflow as a group         | A workflow can be added as a group inside an existing document, as one undoable change.                                                                                    |
| Preview                     | The workflow page previews the last image added.                                                                                                                           |

## 1. Explicit canvas

- [x] Add width, height and background to the document, and remove the "first layer sets the canvas" rule from the planner, previews, thumbnails, exports, messages and docs.
- [x] Opening an image or a library image sets the canvas once from that image.
- [x] `set-canvas` as a `DocumentChange`, undoable, with a CLI command and its `parity.ts` entry.
- [x] File > New document on the website, and matching options on `document create` (size, background).
- [x] Sub-documents inherit the parent's canvas; a group offsets and scales its content only. Write this in `docs/layer-pipeline.md`.
- [x] Update the `.lemon` file format document and the validation error for old files.

## 2. Image layers and the layer-kind registry

- [x] One shared placement-settings definition used by layers and groups.
- [x] A `kind` field on layers; refuse unknown kinds in the schema.
- [x] The layer-kind registry: validation, image ownership, planning, sidebar display. Move every direct `image` check behind it.
- [x] Allow an empty image layer; the planner and renderer skip it until it has an image.
- [x] Rename `layer` to `image layer` in code, CLI (`--image-layer`), labels, docs and e2e.
- [x] Key bindings: rename the action ids and labels that mention layers (`edit.insertImage`, `edit.replaceImage`), update `default-bindings.json`, and rely on the tolerant reader for stored overrides.
- [x] Add a way to put an image into an empty layer (website and CLI).

## 3. Workflows use the pipeline model

- [x] Replace the workflow graph (nodes, edges, positions) with a pipeline, its input slots and its output settings.
- [x] Workflow runs fill the slots once per input image; keep run handling outside the shared model.
- [x] Define the slot fill order (step order) and what happens when an image set supplies fewer images than there are slots.
- [x] Workflow "match the first image" canvas mode for runs.
- [x] Drop the Composite tool from workflows, after checking that image layers cover what it did.
- [x] Update the workflow service, DAO, server functions, CLI commands, `parity.ts`, `schema` and docs for the new model.

## 4. Context rules and create-from

- [ ] Context rules on the step-kind registry: where a kind may appear and what it does in each place.
- [ ] Pure function: pipeline to a new workflow pipeline (clear the layer images, keep their settings).
- [ ] Pure function: pipeline to a new document pipeline (keep layers and settings).
- [ ] The same for a group and for a sub-document as the source.
- [ ] Canvas for a new document from a workflow: from the chosen image or library image; else from the first step's size settings; else the user sets it, on the website and the CLI.
- [ ] CLI: `workflow create --from-document <id> [--group <stepId>]` and `document create --from-workflow <id>`, with parity entries.
- [ ] Website: "New workflow from document / group / sub-document" and "New document from workflow".
- [ ] Add a workflow as a group inside an existing document: an undoable `DocumentChange`, a CLI command, a website control and a parity entry.
- [ ] Document that going from a document to a workflow and back drops the images.

## 5. Shared shell and the workflow page

- [ ] The floating panel and the menu take a context (`document` or `workflow`) and build their tabs and items from a list for it. Items that do not apply are not shown.
- [ ] Workflow-specific tabs: inputs, run settings, run results.
- [ ] Reuse the step list, the Tools browser and the Options tab on the workflow page.
- [ ] Remove the node canvas and the tool column on its right.
- [ ] Workflow page preview: the last image added, through the existing render path; an empty state until one is added.

## 6. Key bindings for the new work

- [ ] A `contexts` field on actions in the registry; hide the actions that do not apply in the current context in the menu and the shortcuts dialog.
- [ ] Register actions for each new feature (set canvas, new document, new workflow from, add workflow as group) with defaults where it makes sense, in the same change as the feature.
- [ ] Update `docs/keybindings.md`.

## 7. Done when

- [ ] Vitest, `tsc`, `biome check .`, `pnpm build` and the Playwright run all pass.
- [ ] `parity.test.ts` passes with entries for everything new.
- [ ] Docs, `schema` and the skill describe the new model; the old graph and "first layer sets the canvas" are gone everywhere.
