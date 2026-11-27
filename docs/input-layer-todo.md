# Input layer to-do

A list of what needs doing, in build order, not a plan. A workflow's input slot today is "the first image layer that is on" (workflow pipeline to-do, decision 17, input slot), so deleting that layer, switching it off or moving another image layer above it silently changes or removes the slot; a workflow left with none failed every preview and thumbnail ("The job failed unexpectedly"). Its diagram pictures also show only the last input image, so how the workflow treats the others cannot be seen before a run. This replaces the implicit slot with an **Input layer** and adds a **filmstrip** of the input images. Every item is built test first, and `tsc`, `biome check .`, Vitest and the Playwright run pass at the end of each section. Every new behaviour gets its website control and its CLI command in the same change, registered in `scripts/images/commands/parity.ts`.

## Decisions

| #   | Decision                    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Input layer                 | Every workflow has exactly one **Input layer**, a layer kind of its own in the layer-kind registry, not an image layer with a flag. It holds whichever input image is being shown or run. It cannot be deleted or switched off, it can be moved within the stack, and it keeps the image layer's placement settings (fit, anchor, opacity, blend). Every image layer is a fixed picture. Replaces decision 17, input slot. |
| 2   | Where it can be             | In the workflow's own pipeline: its top level, its groups and its embedded document layers. Never inside a document layer or a workflow layer, and never in a document or anything nested in one.                                                                                                                                                                                                                          |
| 3   | Workflow layers             | A workflow layer used in a document or a workflow fills the used workflow's own Input layer with the layer's image, as today (decision 27, smaller rules). An outer workflow's Input layer never reaches into it.                                                                                                                                                                                                          |
| 4   | Document from a workflow    | The Input layer becomes an image layer holding the shown input image; with none, the layer stays empty. Replaces the slot wording of decision 4, document from a workflow, and decision 26, create-from a used item.                                                                                                                                                                                                       |
| 5   | Workflow from a document    | Making a workflow from a document or from a group asks which image layer becomes the Input layer; with no image layer, an empty Input layer is added first. Replaces the slot wording of decision 2, workflow from a document, and decision 7, what the new pipeline holds.                                                                                                                                                |
| 6   | Filmstrip                   | A row of the workflow's input images, as thumbnails, along the bottom of the workflow editor. Clicking one selects it: it fills the Input layer in every node thumbnail and the preview. The selection is screen-only (not saved, `screenOnly` in parity) and defaults to the last image added. The Input layer's settings stay on its step, shared by every image.                                                        |
| 7   | CLI                         | `workflow preview --source <id>` renders a node with that input image (default: the last added, as the website). The Input layer is listed as its own step kind; `step move` works on it, and `step delete` and `step set --enabled off` refuse it with a validation error (CLI exit code for validation).                                                                                                                 |
| 8   | Existing workflows and runs | A migration turns each stored workflow's current slot (its first image layer that is on, at any depth allowed by decision 2) into its Input layer, keeping its id and settings, and adds an empty one at the top of the stack where there is none. Stored run definitions are migrated the same way, so old runs still render.                                                                                             |

## 1. The Input layer in the model

- [ ] Tests first: the layer-kind registry has an `input` kind; its schema is the image layer's placement settings without an image; a workflow definition with no Input layer, or with two, fails `WorkflowDefinitionSchema`; one inside a document layer or workflow layer fails it (decision 2, where it can be); a document pipeline with one fails the document schema.
- [ ] Add the kind to `src/features/pipeline/layer-kinds.ts` with its name, icon and options (decision 1, input layer), and to the zod schemas, so the types derive from them.
- [ ] `segments.ts`: `inputSlot` finds the Input layer; `fillInputSlot` puts the image in it and cannot fail; `workflowProblem` drops the "Add an image layer" case. Remove `NO_SLOT` and `NO_SLOT_TO_FILL`.
- [ ] Rendering: an Input layer with an image draws as an image layer; with none it draws nothing, as an empty image layer does. Render keys include its image.
- [ ] `DocumentChange`: delete and switch-off of the Input layer are refused in the core (`applyChange` validation), so the website and the CLI share the rule. Tests for both front doors.
- [ ] `createWorkflow` starts with an empty Input layer instead of an image layer.

## 2. Migration

- [ ] Tests first, against a real database (decision 14 of the job workers to-do, test databases): a workflow whose first enabled image layer is nested in a group keeps it there as the Input layer with the same id and settings; one with no image layer gets an empty Input layer at the top; a disabled first image layer stays an image layer and the next enabled one becomes the Input layer; a document layer's inner image layers are never chosen; run definitions are migrated the same way; running the migration twice changes nothing.
- [ ] A Knex migration over `workflows.definition` and the run definitions (decision 8, existing workflows and runs), in batches, in one transaction per batch.
- [ ] Document bundles carry the workflow definitions their workflow layers use (`docs/document-file-format.md`). A file saved before this change has workflows without an Input layer; following decision 19, saved data, of the workflow pipeline to-do, it fails validation and is refused as not a valid document, with no conversion code. Test it.

## 3. Create-from and layers

- [ ] Tests first for decisions 3, 4 and 5 (workflow layers, document from a workflow, workflow from a document), through the services and the CLI.
- [ ] `create-from.ts` and `workflow-from-steps.ts`: the Input layer becomes an image layer (document from a workflow); the chosen image layer becomes the Input layer (workflow from a document or a group). The website dialog and the CLI option name the image layer to use.
- [ ] `used-pictures.ts`: a workflow layer fills the used workflow's Input layer.

## 4. The shown input image

- [ ] Tests first: a workflow preview and a workflow thumbnail job for a chosen input image draw that image; two images give two cached pictures; a source that is not one of the workflow's inputs is a validation error; with none chosen, the last added is used.
- [ ] `requestWorkflowPreview` and `requestWorkflowThumbnails` take an optional `sourceId`; it goes in the job payload and the render key. `WorkflowPlanner.filled` uses it instead of `inputs.at(-1)`. Latest-wins compares it too.
- [ ] CLI: `workflow preview --source <id>` (decision 7, CLI); `schema` and `parity.ts` updated.

## 5. The workflow editor

- [ ] Tests first (component tests, then Playwright): the Input layer step has no delete or switch-off control, in the diagram, the sidebar and the keyboard actions; it can be moved; the filmstrip lists every input image with its thumbnail and an accessible name; clicking or pressing Enter on one selects it and every node thumbnail and the preview change to it; adding an image selects it; removing the selected one selects the last remaining.
- [ ] The Input layer step node, built from the shared step parts with its own registry entry; what differs (no delete, its name) comes from the registry, not from a branch in the shared parts.
- [ ] The filmstrip, composed from small parts (strip, thumbnail item), along the bottom of the editor; keyboard navigation with the arrow keys; the selection lives in the screen store.
- [ ] Decide in the build whether the Inputs node stays as the place to add and remove images or moves into the filmstrip; record the choice here.
- [ ] Screenshots of the editor with the filmstrip, checked with the Playwright MCP.

## 6. Docs

- [ ] `docs/workflow-pipeline-todo.md`: mark decision 17 as replaced by this to-do's decision 1, and update the slot wording of decisions 2, 4, 7, 26 and 27.
- [ ] `docs/layer-pipeline.md`, `docs/glossary.md` (Input layer, filmstrip), the editor pipeline plan, the README's CLI section and `pnpm images schema`.

## 7. Done when

- [ ] Vitest, `tsc`, `biome check .`, `pnpm build` and the Playwright run (on the production build) all pass.
- [ ] A workflow can no longer be left without an input: no delete or switch-off reaches its Input layer from the website or the CLI.
- [ ] Choosing an image in the filmstrip shows that image in every node thumbnail and the preview, and `workflow preview --source` gives the same picture.
- [ ] Every stored workflow and run renders after the migration.
