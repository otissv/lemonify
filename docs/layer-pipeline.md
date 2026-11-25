# Layer pipeline

A document is a canvas and an ordered list of steps. Steps run in order, each on the picture the steps before it made, starting from the blank canvas. This file records how images are layered in that picture and why, so the code and the screens can be checked against it.

## The model

A document has a **canvas**: a width and a height in pixels (1 to 65535, at most about 268 million pixels in all, which is Sharp's own limit) and a background, either `transparent` or a colour written `#rrggbb`. The canvas is stored in the pipeline, next to the steps, so it is part of every undo, every document file and every render key. Nothing derives the canvas from an image after the document is made: opening an image makes a document whose canvas is the size of that image, once, and from then on the canvas changes only when the person changes it (`set-canvas`, one undoable edit; File > New document and `document create --width --height` start from a canvas of their own).

Every image in a document is an **image layer** step, drawn on the canvas like any other step. An image layer may be **empty**: it keeps its settings and draws nothing until it has an image (`set-image`, one undoable change that fills it or, with no image, empties it). There is no "canvas layer": the first layer is not special, it has the same settings as the rest, and any layer can be hidden, moved, replaced or deleted without the picture changing size. A new document opened from an image has one layer holding that image. A document may have no layer at all, and then its picture is the blank canvas.

Every step acts on the picture as it stands, starting from the blank canvas. A layer is drawn on it with its own settings, so an effect placed after a layer affects the layer too, and an effect placed before it does not. A step before the first layer works on the blank canvas.

A layer is on top of everything before it in the pipeline. The sidebar lists the steps with the last on top, the way layer panels do, so the row at the top of the list is drawn on top. Moving a row up moves it later in the pipeline and so closer to the viewer.

No step merely "opens" an image for another step to use. A step that needs a second image (boolean, join channel) names an image from the library directly, as a layer does.

## Groups and sub-documents

A **group** is a step that holds other steps. It has a name, an on/off switch, and a list of steps of its own; it can hold layers, effects and AI steps, but not another group, so groups are one level deep (at most 200 steps in a group, 1000 in a pipeline, every id unique across the pipeline). Moving, switching off or deleting a group does it to everything in it. Switching a group off turns off every step in it, whatever their own switches say; switching it on again gives each step back its own. Whether a group is drawn open or closed in the sidebar is a matter of the screen: it is not saved in the document.

By default a group changes nothing about the picture. The planner opens it, so the render keys, AI results and thumbnails are exactly those of the same steps without the group. Grouping and ungrouping can therefore be undone and redone freely and never makes anything run again.

A group can instead be a **sub-document**: a picture of its own. It starts from a blank canvas of the same size and background as the document's (a sub-document always inherits its parent's canvas; it has none of its own to set), the steps in it draw on and act on that picture only, and the result is placed on the document's canvas like a layer. A group offsets and scales its content only; it never changes the canvas. A sub-document therefore carries the layer settings (`opacity`, `blend`, `fit`, `scale`, `rotation`, `anchor`, `x`, `y`), which say where and how it lands; they are stored on every group but only used while it is a sub-document. Resizing the logo inside a sub-document resizes the logo and nothing else on the canvas. A sub-document with no layer that is on is a picture with nothing in it: it is drawn, and adds nothing visible.

The two modes share the stored step, the editing code, undo, the CLI and the sidebar; only the planner treats them differently, in one place (`planSteps`, which opens a group that is not a sub-document and keeps one that is). AI steps inside a sub-document run on the sub-document's own picture, one at a time like all AI steps, and their results are stored under keys made from that picture. Their order among the AI steps of the main canvas is the order of the pipeline: an AI step waits for every one that comes before it, in or out of a sub-document. A step in a sub-document gets a small picture of the sub-document at that step, and the sub-document itself one of its place on the canvas.

| Edit                           | Website                                                            | CLI                                                        |
| ------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Group steps next to each other | Pick steps with Ctrl/Shift in the sidebar, then the toolbar button | `document step group <id> <stepIds> [--name]`              |
| Take a group apart             | Ungroup in the group's options                                     | `document step ungroup <id> <groupId>`                     |
| Move a step in or out          | Drag it on or off a group, or use the move buttons                 | `document step move <id> <stepId> <to> [--into <groupId>]` |
| Add a step to a group          | Select a step in the group, then add from Tools                    | `document step add <id> ... --group <groupId>`             |
| Name, switch, delete a group   | The group's row and options                                        | `document step rename`, `enable`, `disable`, `remove`      |
| Make it a sub-document         | "Own picture" in the group's options                               | `document step set <id> <groupId> --sub-document on\|off`  |
| Place a sub-document           | The same settings as a layer, in the group's options               | `document step set <id> <groupId> --settings <json>`       |
| Reset a placement              | Reset to defaults, at the bottom of the layer's or group's options  | `document step reset <id> <stepId>`                        |

## Layer kinds

A layer has a `kind`, and `image-layer` is the only one today. The registry in `src/features/pipeline/layer-kinds.ts` owns everything that depends on the kind: its schema, its title, which library images it uses and how they are renamed when a pipeline moves, why it is not set up, how the sidebar shows it, and how the planner turns it into a drawn image, an empty layer or a layer whose image is gone. Nothing else checks for `image-layer`; an unknown kind is refused by the schema. The settings that place a layer (`opacity`, `blend`, `fit`, `scale`, `rotation`, `anchor`, `x`, `y`) are defined once and shared by every kind and by groups.

## Workflows

A workflow is the same pipeline a document has (canvas and steps, groups and sub-documents included), plus the library images it runs on (`inputs`, each at most once) and its output settings. Its **input slots** are the image layers that are switched on and have no image, in pipeline order, wherever they are. A run makes one item per input image. The image fills the first slot (a `set-image` change on that item's copy of the pipeline), and the other slots stay empty and draw nothing. A workflow with no slot cannot run, and nothing runs without an input image. A layer that has an image is fixed: it draws the same image in every item, as a logo would.

A workflow's canvas size is saved with it (`canvasSize`): `match-input`, the default for a new workflow, draws each item on a canvas the size of its image and keeps the workflow's background, as a document opened on that image would be; `fixed` draws every item on the workflow's own canvas. It is chosen in the Canvas node's options or with `workflow create|update --canvas-size`, is an undoable change, and a run keeps it in its copy of the workflow.

The pipeline is cut into segments at every enabled AI step: a draw segment (layers and Sharp steps, planned and drawn as a document is), then the AI step on the result, then the next draw segment, always starting and ending with a draw segment. The first draw segment starts from the canvas and each later one from the picture the AI step made. The last is exported with the workflow's output settings, naming the input image as the original whose format "same as original" keeps. A step that cannot be applied (a layer whose image is gone, a tool that is not set up) fails the item with a message. AI steps inside a sub-document are refused when a workflow runs.

The Composite tool is not offered in workflows, as in documents: an image layer does what it did. Image layers do not cover generated inputs (`create`, `text`), the `tile` option and the Porter-Duff blend modes of Composite. The `sharp` command keeps Composite for one-off work on files.

On the website a workflow is drawn as a diagram in the middle of the page: the canvas, the input images, the steps in order and the output form the main line, and the steps of a group hang under it as a branch that joins the line again. The layout is worked out from the pipeline (`workflow-graph-layout.ts`), so nothing about it is stored. Selecting a node shows its options in the floating panel, the same panel a document has, with the tabs that apply to a workflow (Tools, Options, Run); a document's panel has none of the workflow's tabs and the other way round. Steps are added from the Tools tab, after the selected node or into a selected group.

A workflow has an Edit history exactly as a document has: each change on the page (a step, a layer, the canvas, the input images, the output settings) is one entry that can be undone and redone from the Run tab, the Edit menu or the keys, and a workflow is held in the client like a document (see the plan's "Client state"). A rename is not an edit.

Workflows saved before this model stored a graph of nodes and edges. They are not converted: they fail to read and must be deleted.

## Layer settings

A layer has an image, switched on or off like any step, and:

| Setting    | Values                                                                                                                       | Meaning                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `opacity`  | 0 to 100, default 100                                                                                                        | How much of the layer shows through, as a percentage. Multiplies the layer's own transparency.                                                                                                                                                                                                   |
| `blend`    | normal, multiply, screen, overlay, darken, lighten, colour-dodge, colour-burn, hard-light, soft-light, difference, exclusion | How the layer's colours combine with the picture under it.                                                                                                                                                                                                                                       |
| `fit`      | inside, original, contain, cover, stretch                                                                                    | How the layer's image is sized to the canvas before `scale`. `inside` shrinks a larger image to fit and never enlarges, `original` keeps its pixels, `contain` fits it inside the canvas and enlarges if needed, `cover` fills the canvas and crops the rest, `stretch` ignores the proportions. |
| `scale`    | 1 to 1000, default 100                                                                                                       | A percentage applied after `fit`.                                                                                                                                                                                                                                                                |
| `rotation` | -180 to 180, default 0                                                                                                       | Degrees clockwise, about the layer's centre.                                                                                                                                                                                                                                                     |
| `anchor`   | the eight compass points or centre, default centre                                                                           | Which point of the canvas the layer is placed against, and which point of the layer touches it.                                                                                                                                                                                                  |
| `x`, `y`   | whole pixels, default 0                                                                                                      | How far the layer is moved from the anchor, right and down.                                                                                                                                                                                                                                      |

The defaults put an image in the middle of the canvas, shrunk if it is larger, fully opaque.

### Decisions

**The canvas never grows.** A layer larger than the canvas, or moved partly off it, is cut off at the canvas edge. The canvas changes size only when the person changes it, or when a geometry step (resize, extract, rotate) changes the picture, as steps before a layer left it. Hiding, moving or deleting a layer never changes the size of the picture. Changing the canvas does not change the steps: layers keep their settings and land where those settings put them on the new canvas.

**Layers are drawn at full resolution.** The preview is made small only at the end, so placement, scale and rotation do not depend on how big the preview is.

**Compositing keeps transparency.** Transparent and partly transparent pixels in the layer, and in the picture under it, are blended by their alpha, so a PNG with a cut-out shows what is behind it. The canvas shows a checkerboard behind the picture so that transparency can be seen, and exporting to a format that cannot hold transparency (JPEG) flattens the picture onto white.

## Blend on a tool, and the Scale and Opacity tools

A filter or colour step can be blended with the picture as it was before the step. It has the same blend modes as a layer and an opacity from 0 to 100; the default (normal, 100) is the plain step and is not stored. Geometry and AI steps cannot be blended: geometry changes the size of the picture, so there is nothing to compare, and an AI step makes a new picture of its own. A blended step is applied on its own: the engine renders the picture before and after it, fades the result by the opacity, and composites it over the earlier picture with the mode. The blend is part of the step's identity, so it changes the render key.

Scale (Geometry) resizes the picture by a percentage, where Resize is in pixels. Opacity (Colour) makes the whole picture more see-through, multiplying the transparency it already has. Sharp has no operation for either that keeps the order of the steps, so both are applied to pixels with the layers and blended steps. Negate keeps the picture's transparency unless `alpha` is set, so it gives the same result wherever it sits in the pipeline.

## How it is rendered

The planner turns the pipeline into a base and an ordered list of engine steps. The base is the blank canvas, or, after an AI step that has a result, that result (the steps before it are baked into it). The steps are Sharp steps, layers with their image resolved to a file, and sub-documents, each with its own base (the same canvas) and engine steps, which the engine renders to pixels first and then places like a layer. A layer whose image is gone is skipped with a message. The engine applies them in order. Sharp does not run its operations in the order they are listed within one pipeline (it resizes before it composites, for instance), so the engine renders the picture to pixels at every layer and builds the next stage from those pixels. The layer's image is oriented, sized by `fit` and `scale`, rotated, given its opacity, cut to the part that is over the canvas, and composited with its blend mode.

Render keys start from the canvas (`canvas:<width>x<height>:<background>`), so another size or background is another picture. They name an image by its content hash and a layer by its settings, and a sub-document by the key-form of everything it applies and its placement (a group that is not a sub-document has no key of its own), so the same document on another machine, with the same pictures under other ids, finds the same keys. That is what lets a document file bring its AI results with it.

## What changed from the earlier models

The first model let a document hold several "Open image" steps, of which the first was the picture and the rest only made their image available to later steps. The second model made the extra ones layers and kept one locked "Image" step at the bottom. The third model removed that special step: every image is a layer, and the first layer that was switched on set the canvas. The current model gives the document an explicit canvas, so no layer is special. The Composite tool, which did the same job with a list of images in its options, is not offered in documents or workflows; only the `sharp` command keeps it.

Existing documents are migrated in two steps. `20260101000500-layers` made extra image steps layers (or dropped those that only supplied a second image to a boolean or join channel step) and each Composite step a layer per image, with its blend mode and placement. `20260101000600-layers-only` turns the remaining image step into a layer with the default settings, in the same place. Undo history of a migrated document is cleared because the steps change. Document files (`.lemon`) made before layers (bundle version 1) are refused with an explanation, and so are documents and files made before the canvas was explicit: their pipeline has no `canvas`, so it fails validation. There is no conversion for either.

## Where it lives

| Concern                                           | Place                                                                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step schemas and constraints, groups, `planSteps` | `src/features/pipeline/pipeline.ts`                                                                                                                  |
| The canvas (schema, identity, limits)             | `src/features/pipeline/canvas.ts`                                                                                                                    |
| Changes and undo                                  | `src/features/pipeline/document-change.ts`                                                                                                           |
| Placement maths (pure)                            | `src/server/render/layer-geometry.ts`                                                                                                                |
| Compositing, sub-document pictures                | `src/server/tools/layer-compositor.ts`, called by `image-engine.ts`                                                                                  |
| Planning and render keys                          | `src/server/render/plan-pipeline.ts`, `render-key.ts`                                                                                                |
| The layer-kind registry                           | `src/features/pipeline/layer-kinds.ts`                                                                                                               |
| Workflow diagram, panel and options               | `src/features/workflows/workflow-canvas.tsx`, `workflow-graph-layout.ts`, `workflow-panel.tsx`, `src/features/tools/tool-tabs.tsx`                   |
| Workflow Edit history and client state            | `src/features/workflows/workflow-change.ts`, `src/features/pipeline/pipeline-session.ts`, `pipeline-sync.ts`, `src/store/`                           |
| Workflows: slots, canvas size, segments           | `src/features/workflows/segments.ts`, `workflow.ts`, `src/server/jobs/handlers/run-item-handler.ts`                                                  |
| Migrations                                        | `migrations/20260101000500-layers.ts`, `20260101000600-layers-only.ts`, `20260101000900-workflow-pipelines.ts`, `20260101001000-workflow-history.ts` |
| Sidebar (rows, groups, toolbar), options, canvas  | `src/features/documents/`, `src/features/app/sidebar-toolbar.tsx`, `src/features/tools/step-options.tsx`                                             |
| CLI                                               | `scripts/images/commands/document-step.ts`                                                                                                           |
