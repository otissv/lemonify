# Layer pipeline

A document is an image and an ordered list of steps. Steps run in order, each on the picture the steps before it made. This file records how images are layered in that picture and why, so the code and the screens can be checked against it.

## The model

Every image in a document is a **layer** step. There is no separate "document image": a document starts with one layer holding the image it was opened from, and any layer can be hidden, moved, replaced or deleted. A document may have no layer at all, and then there is nothing to show until one is added.

The first layer that is switched on, and whose image still exists, is the **canvas**. Its image, at its own size, is the picture the steps after it start from. Every later layer is drawn on the picture as it stands and carries on. The canvas layer's own settings are not used (it has nothing beneath it); they take effect when another layer is placed below it. The steps after a layer, including effects, act on the picture with the layer in it, so an effect placed after a layer affects the layer too, and an effect placed before it does not. Steps before the canvas layer have no picture to work on and are skipped, with a message.

A layer is on top of everything before it in the pipeline. The sidebar lists the steps with the last on top, the way layer panels do, so the row at the top of the list is drawn on top and the canvas layer is the lowest layer row. Moving a row up moves it later in the pipeline and so closer to the viewer. The canvas layer's row says so ("Canvas · file name").

No step merely "opens" an image for another step to use. A step that needs a second image (boolean, join channel) names an image from the library directly, as a layer does.

## Groups and sub-documents

A **group** is a step that holds other steps. It has a name, an on/off switch, and a list of steps of its own; it can hold layers, effects and AI steps, but not another group, so groups are one level deep (at most 200 steps in a group, 1000 in a pipeline, every id unique across the pipeline). Moving, switching off or deleting a group does it to everything in it. Switching a group off turns off every step in it, whatever their own switches say; switching it on again gives each step back its own. Whether a group is drawn open or closed in the sidebar is a matter of the screen: it is not saved in the document.

By default a group changes nothing about the picture. The planner opens it, so the render keys, AI results and thumbnails are exactly those of the same steps without the group. Grouping and ungrouping can therefore be undone and redone freely and never makes anything run again.

A group can instead be a **sub-document**: a picture of its own. Its first layer that is on, and whose image exists, sets its size (so a sub-document has its own canvas), the steps in it act on that picture only, and the result is placed on the main canvas like a layer. A sub-document therefore carries the layer settings (`opacity`, `blend`, `fit`, `scale`, `rotation`, `anchor`, `x`, `y`), which say where and how it lands; they are stored on every group but only used while it is a sub-document. Resizing the logo inside a sub-document resizes the logo and nothing else on the canvas. A sub-document with no layer that is on has no picture: it is left out of the render with a message ("No layer in this group is on…"), and an export is refused until it has one. A layer inside a sub-document never becomes the main canvas, and a sub-document that comes before the main canvas layer is skipped like any step there.

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

**The canvas never grows.** A layer larger than the canvas, or moved partly off it, is cut off at the canvas edge. The canvas is the canvas layer's image, as steps before the layer left it, so a resize step before a layer changes where the layer lands, and one after it scales the layer along with everything else. It keeps every render the size the person sees. Hiding, moving or deleting the canvas layer makes the next layer the canvas, and the picture takes that image's size.

**Layers are drawn at full resolution.** The preview is made small only at the end, so placement, scale and rotation do not depend on how big the preview is.

**Compositing keeps transparency.** Transparent and partly transparent pixels in the layer, and in the picture under it, are blended by their alpha, so a PNG with a cut-out shows what is behind it. The canvas shows a checkerboard behind the picture so that transparency can be seen, and exporting to a format that cannot hold transparency (JPEG) flattens the picture onto white.

## Blend on a tool, and the Scale and Opacity tools

A filter or colour step can be blended with the picture as it was before the step. It has the same blend modes as a layer and an opacity from 0 to 100; the default (normal, 100) is the plain step and is not stored. Geometry and AI steps cannot be blended: geometry changes the size of the picture, so there is nothing to compare, and an AI step makes a new picture of its own. A blended step is applied on its own: the engine renders the picture before and after it, fades the result by the opacity, and composites it over the earlier picture with the mode. The blend is part of the step's identity, so it changes the render key.

Scale (Geometry) resizes the picture by a percentage, where Resize is in pixels. Opacity (Colour) makes the whole picture more see-through, multiplying the transparency it already has. Sharp has no operation for either that keeps the order of the steps, so both are applied to pixels with the layers and blended steps. Negate keeps the picture's transparency unless `alpha` is set, so it gives the same result wherever it sits in the pipeline.

## How it is rendered

The planner turns the pipeline into a base image and an ordered list of engine steps: Sharp steps, layers with their image resolved to a file, and sub-documents, each with its own base image and engine steps, which the engine renders to pixels first and then places like a layer. The engine applies them in order. Sharp does not run its operations in the order they are listed within one pipeline (it resizes before it composites, for instance), so the engine renders the picture to pixels at every layer and builds the next stage from those pixels. The layer's image is oriented, sized by `fit` and `scale`, rotated, given its opacity, cut to the part that is over the canvas, and composited with its blend mode.

Render keys name an image by its content hash and a layer by its settings, and a sub-document by the key-form of everything it applies and its placement (a group that is not a sub-document has no key of its own), so the same document on another machine, with the same pictures under other ids, finds the same keys. That is what lets a document file bring its AI results with it.

## What changed from the earlier models

The first model let a document hold several "Open image" steps, of which the first was the picture and the rest only made their image available to later steps. The second model made the extra ones layers and kept one locked "Image" step at the bottom. The current model removes that special step: every image is a layer. The Composite tool, which did the same job with a list of images in its options, is not offered in documents (the workflow editor and the `sharp` command keep it, since they have no layers).

Existing documents are migrated in two steps. `20260101000500-layers` made extra image steps layers (or dropped those that only supplied a second image to a boolean or join channel step) and each Composite step a layer per image, with its blend mode and placement. `20260101000600-layers-only` turns the remaining image step into a layer with the default settings, in the same place. Undo history of a migrated document is cleared because the steps change. Document files (`.lemon`) made before layers (bundle version 1) are refused with an explanation; there is no conversion for files.

## Where it lives

| Concern                                           | Place                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Step schemas and constraints, groups, `planSteps` | `src/features/pipeline/pipeline.ts`                                                                      |
| Changes and undo                                  | `src/features/pipeline/document-change.ts`                                                               |
| Placement maths (pure)                            | `src/server/render/layer-geometry.ts`                                                                    |
| Compositing, sub-document pictures                | `src/server/tools/layer-compositor.ts`, called by `image-engine.ts`                                      |
| Planning and render keys                          | `src/server/render/plan-pipeline.ts`, `render-key.ts`                                                    |
| Migrations                                        | `migrations/20260101000500-layers.ts`, `20260101000600-layers-only.ts`                                   |
| Sidebar (rows, groups, toolbar), options, canvas  | `src/features/documents/`, `src/features/app/sidebar-toolbar.tsx`, `src/features/tools/step-options.tsx` |
| CLI                                               | `scripts/images/commands/document-step.ts`                                                               |
