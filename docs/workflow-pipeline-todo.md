# To do: layers and workflow pipelines

A list of what needs doing, not a plan. Every item is built test first, and every feature gets its CLI command, its website control and its `parity.ts` entry in the same change (see `CLAUDE.md`). Nothing keeps old behaviour: no compatibility code and no `BUNDLE_VERSION` bump; an old `.lemon` file gets the ordinary validation error. Stored data is not migrated either (section 4, decision 19, saved data).

Out of scope: batch steps, input steps, and layer kinds other than `image`, `document` and `workflow`.

## Decisions already made

| Decision                    | Means                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit canvas             | A document stores its own width, height and background. Nothing derives the canvas from an image after creation.                                                           |
| Image layer                 | `layer` is renamed `image layer`. It may be empty, keeps all its settings and draws nothing until it has an image.                                                         |
| Layer kinds                 | A layer has a `kind`: `image`, and in section 4 `document` and `workflow`. A registry owns validation, image ownership, planning and sidebar display. No consumer checks for a kind directly. |
| One placement definition    | Fit, scale, rotation, anchor, x, y, opacity and blend are defined once and reused by every layer kind and by groups.                                                       |
| Workflow is a pipeline      | A workflow stores the same step model as a document, including groups and embedded document layers, plus its input slot and output settings. The input slot is set by section 4's decision 17, input slot. |
| Create from, not convert    | "New document from workflow", "New workflow from document", and the same for a group or embedded document layer. The source is never changed.                                         |
| Context rules per step kind | A step kind says where it may appear and how it behaves there. The differences between a document and a workflow live in the create-from functions, not in the pipeline.   |
| Workflow as a group         | A workflow can be added inside an existing document as an embedded document layer (a copy), or as a workflow layer that uses it, each as one undoable change. See section 4.    |
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

## 4. Nested documents, document and workflow layers, and create-from

### Section 4 decisions

Each decision is cited by its number and short name, for example "decision 9, nesting". The words are defined in [the glossary](glossary.md).

| #   | Short name                  | Decided                                                                                                                                                                                                                                                                                 |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Context rules               | Each step kind's registry entry says how a step of that kind is copied into a document and into a workflow. Every kind is allowed in both; there is no allow-list until a kind needs one.                                                                                              |
| 2   | Workflow from a document    | Creating a workflow from a document asks what to do with the images: keep them all, remove them all, or remove only the input image (the first image layer's).                                                                                                                         |
| 3   | Its canvas and inputs       | The new workflow's canvas size mode is **Set size**, with the document's canvas. The images removed by decision 2 become the workflow's inputs. Output settings are the defaults, since a document stores none.                                                                       |
| 4   | Document from a workflow    | The input slot becomes a plain image layer holding the input image the workflow shows (the last one added); with no input image, the layer stays empty. Every other step is copied as it is.                                                                                           |
| 5   | Its canvas                  | Follows the workflow's canvas size mode. **Set size**: the workflow's canvas. **Match each input image**: the size of the image put in the layer; with none, the website asks for the size and the CLI requires `--width` and `--height`.                                              |
| 6   | Group as the source         | A group or an embedded document layer can be the source in both directions: `workflow create --from-document <id> --group <stepId>` and `document create --from-workflow <id> --group <stepId>`.                                                                                     |
| 7   | What the new pipeline holds | The group's steps become the new pipeline's top level and the group's own placement settings are dropped. The canvas is the parent's. A new workflow whose steps have no image layer gets an empty one first, as its input slot.                                                    |
| 8   | Workflow added as a group   | Adding a workflow into a document makes an embedded document layer named after the workflow: a copy, not tied to the workflow. The chosen image fills its input slot (empty if none). It goes after the selected step, or at the end.                                                 |
| 9   | Nesting                     | A group holds steps and groups, never an embedded document layer. An embedded document layer holds steps, groups, embedded document layers, document layers and workflow layers. Nesting is built first in this section.                                                             |
| 10  | Deleting something in use   | Deleting a document or workflow that a document layer or workflow layer uses is refused, naming the documents and workflows that use it.                                                                                                                                              |
| 11  | Convert to embedded         | **Convert to embedded document layer** (the layer's ⋯ menu; `document step convert <stepId> --to embedded-document` on the CLI) turns a document layer or workflow layer into an embedded document layer holding a copy of its steps, so one place can change on its own.            |
| 12  | Export and import           | A `.lemon` file (a zip) carries the document and every document and workflow its layers use, however deep. Importing always creates new documents and workflows, and the layers point at those, so they stay document and workflow layers.                                           |
| 13  | No circular references      | A document layer or workflow layer that would lead back to the document or workflow holding it, at any depth, is refused. A workflow may hold a workflow layer.                                                                                                                       |
| 14  | Canvas and output inside    | A Document layer renders the used Document at its own Canvas size and background; a Workflow layer renders the Workflow at the size its Canvas size mode gives for the layer's image. The picture is then placed like an Image layer, with its Placement settings. A Workflow's Output settings are ignored there. An Embedded document layer has no Canvas of its own and uses its parent's size. |
| 15  | Layers inside a group       | A group may hold document layers and workflow layers, since each is one step.                                                                                                                                                                                                         |
| 16  | Depth                       | At most 8 levels of groups and embedded document layers.                                                                                                                                                                                                                              |
| 17  | Input slot                  | A workflow's input slot is its first image layer, with or without an image; a run replaces that layer's image. Every other image layer is fixed and draws the same image in every item. This replaces "the image layers that are on and have no image".                             |
| 18  | Edit history                | A change inside an embedded document layer, at any depth, is one entry in the Edit history of the document or workflow that holds it. A document layer or workflow layer is never edited in place: clicking it opens its own editor, and its changes go on its own Edit history.     |
| 19  | Saved data                  | No migration: nothing is in production, so the schema changes and the local database and `.data` folder are deleted once. Old `.lemon` files are not supported: none are in use. |
| 20  | AI inside a document layer  | The parent uses the used Document's AI Step Results. A missing one is queued as that Document's Job, and that Document owns and keeps it. The parent shows the usual waiting state.                                                                                                 |
| 21  | AI inside a workflow layer  | Its AI Steps act on the layer's own image, so they run for the parent Document and their Results belong to it.                                                                                                                                                                      |
| 22  | AI at any depth in a run    | The "AI steps inside a sub-document cannot run in a workflow yet" limit is lifted: a Run's Segments are planned through nested levels, Document layers and Workflow layers.                                                                                                        |
| 23  | Runs copy what they use     | A Run copies, when it starts, the current version of every Document and Workflow its layers use, as it copies its own definition.                                                                                                                                                   |
| 24  | Total depth                 | One limit of 8 levels in total, counting Groups, Embedded document layers and the items Document and Workflow layers use. This widens decision 16, depth.                                                                                                                           |
| 25  | How deep "all images" is    | Decision 2's "keep all" and "remove all" cover every Image layer at any depth of Groups and Embedded document layers, never one inside a Document or Workflow layer.                                                                                                               |
| 26  | Create-from a used item     | A Document layer or Workflow layer can be the source of create-from directly: it works on the item the layer uses, as if that item were opened. From a Workflow layer, the layer's own image is the input image (decision 4, document from a workflow).                             |
| 27  | Smaller rules               | The input slot is the first Image layer in pipeline order at any depth of Groups and Embedded document layers, never inside a Document or Workflow layer. The sidebar shows nesting as an indented tree with dragging between levels; the workflow diagram shows each Group and Embedded document layer as a frame around its Steps. A Workflow layer with no image draws without an input, like an empty Image layer. Layers use only the User's own Documents and Workflows. **Document layer** and **Workflow layer** are in the Tools browser beside **Image layer**; each opens a picker of the User's Documents or Workflows, and a Workflow layer also asks for its image. |

### To do, in build order

- [ ] **Saved data** (decision 19, saved data): note in the change that the local database and `.data` must be deleted once.
- [ ] **Names.** Rename "sub-document" and the **Own picture** switch to **embedded document layer** in code, UI labels, the CLI (`--sub-document`), the `.lemon` format, docs and e2e. A group that is not one stays a **group**.
- [ ] **Input slot rule** (decision 17, input slot) in `segments.ts`, the run handler, the workflow preview, `docs/layer-pipeline.md` and the glossary.
- [ ] **Nesting** (decision 9, nesting; decision 16, depth): the schema, the planner and renderer, render keys, thumbnails, the group `DocumentChange` kinds (moving a step into, out of and between levels), the document sidebar, the workflow diagram, the CLI, `parity.ts`, `schema` and docs. Lift the "AI steps inside a sub-document cannot run in a workflow yet" limit (decision 22, AI at any depth in a run).
- [ ] **Context rules** on the step-kind registry (decision 1, context rules).
- [ ] **Pure function: pipeline to a new workflow pipeline**, with the three image choices (decision 2, workflow from a document; decision 3, its canvas and inputs).
- [ ] **Pure function: pipeline to a new document pipeline** (decision 4, document from a workflow; decision 5, its canvas).
- [ ] **The same for a group, an embedded document layer, a document layer and a workflow layer as the source** (decision 6, group as the source; decision 7, what the new pipeline holds; decision 26, create-from a used item).
- [ ] **CLI:** `workflow create --from-document <id> [--group <stepId>] --images keep|remove|remove-input` and `document create --from-workflow <id> [--group <stepId>] [--width --height]`, with parity entries.
- [ ] **Website:** "New workflow from document / group / embedded document" (with the image choice) and "New document from workflow", each with its key action (registry and runner, no default key). The name is the source's, made unique and editable; the CLI's `--name` is optional. The new item opens.
- [ ] **Add a workflow as an embedded document layer** (decision 8, workflow added as a group): an undoable `DocumentChange`, a CLI command, a website control, its key action and a parity entry.
- [ ] **Document layer and workflow layer:** two layer kinds in the layer-kind registry. Each stores the id of the document or workflow it uses and its placement settings; a workflow layer also stores the image for the workflow's input slot. Rendering reads the current pipeline of what it uses, so render keys include that item's revision, and a change to it re-renders, and live-updates, everything that uses it. The layer shows as one row; clicking it opens the document or workflow (decision 18, edit history). Canvas and output follow decision 14, canvas and output inside; AI Steps follow decisions 20 and 21 (AI inside a document layer, AI inside a workflow layer); Runs follow decision 23, runs copy what they use; depth follows decision 24, total depth. Insert actions on the website and the CLI, each with a `DocumentChange`, a key action and a parity entry.
- [ ] **Deleting something in use** (decision 10) and **no circular references** (decision 13), in the services, with their messages on both front doors.
- [ ] **Convert to embedded document layer** (decision 11, convert to embedded): an undoable `DocumentChange`, the menu item, the CLI command and a parity entry.
- [ ] **Export and import** (decision 12, export and import): the `.lemon` zip holds every document and workflow used; `docs/document-file-format.md` describes it.
- [ ] **Docs:** going from a document to a workflow and back drops the images the user chose to remove; the glossary, `docs/layer-pipeline.md`, `schema` and the skill describe nested, embedded, document and workflow layers.

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
