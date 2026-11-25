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
| Action contexts             | Every action names the pages it applies on (`home`, `document`, `workflow`); there is no default. The menu hides items for other pages and their keys do nothing there.    |
| One key, one action         | A key does the same thing on every page. No two actions share a key, whatever their contexts, so the conflict checks stay as they are.                                     |
| Canvas size mode            | A workflow's canvas is either **Match each input image** (the default for a new workflow) or **Set size**, chosen in the Canvas node's options and saved with the workflow as an undoable change. It replaces the per-browser run canvas choice. |
| Runs in the side panel      | The workflow page's right-hand panel has two tabs: **Preview** (the selected node's picture) and **Runs** (a new run with an image picker, and one row per run with progress, Stop, Download all and a `⋯` menu). Selecting a node shows Preview. View has **Step preview** (Alt+P) and **Run panel** (Alt+R); each opens the panel on its tab, and choosing the ticked one hides it. The floating panel has no Run tab. |
| Runs on chosen images       | A run is started on a chosen subset of the workflow's input images (`workflow run --sources`). Progress is a count and a bar, not the step. A finished run's results download as one zip. |
| Shortcuts by category       | The Keyboard shortcuts dialog lists every action by category (Edit, Step, View, Add tool…), never by page. Actions only a workflow has get a Workflow category.             |

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
- [ ] Website: "New workflow from document / group / sub-document" and "New document from workflow", each with its key action (registry, runner, a default key where it makes sense) in the same change.
- [ ] Add a workflow as a group inside an existing document: an undoable `DocumentChange`, a CLI command, a website control, its key action and a parity entry.
- [ ] Document that going from a document to a workflow and back drops the images.

## 5. Shared shell and the workflow page

- [ ] The floating panel and the menu take a context (`document` or `workflow`) and build their tabs and items from a list for it. Items that do not apply are not shown.
- [x] Canvas size mode on the Canvas node (see the decisions), with `workflow create|update` flags; `workflow run --canvas` and the per-browser choice go.
- [x] Runs on chosen images (`workflow run --sources`) and a zip download of a run's results, on the website and the CLI.
- [x] The Runs tab in the right-hand panel, and View > Run panel (Alt+R).
- [x] Remove the Run tab from the floating panel; its Saved status and Undo/Redo go with it (undo stays in Edit, and a failed save shows as a notice over the diagram).
- [x] Reuse the floating panel and the Tools browser on the workflow page.
- [x] Remove the tool column on the left and the options column on the right; the diagram stays in the middle.
- [x] Workflow page preview: the last image added, through the existing render path; an empty state until one is added.

- [x] Workflows are held, edited and synced in the client like documents (one session type, one sync), with an Edit history identical to a document's (`workflow_history`, `WorkflowChange`, CLI `workflow rename|undo|redo`, `workflow update --without`), and the web sidebar can rename and delete a workflow. Client state is three stores: UI, pipelines (sessions and renders) and library (images, results, runs).

## 6. Key bindings for the new work

- [x] A `contexts` field on actions in the registry; the menu hides the items whose action does not apply on the page, and their keys do nothing there. The shortcuts dialog keeps every action, grouped by category. `keys list` shows each action's contexts.
- [x] Register an action for setting the canvas (built in section 1, with no action yet), with a default key if it makes sense. New document already has `file.newDocument`; the create-from and add-as-group actions are built with their features in section 4.
- [x] Update `docs/keybindings.md`.

## 7. Done when

- [ ] Vitest, `tsc`, `biome check .`, `pnpm build` and the Playwright run all pass.
- [ ] `parity.test.ts` passes with entries for everything new.
- [ ] Docs, `schema` and the skill describe the new model; the old graph and "first layer sets the canvas" are gone everywhere.
