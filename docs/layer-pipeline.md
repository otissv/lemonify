# Layer pipeline

A document is an image and an ordered list of steps. Steps run in order, each on the picture the steps before it made. This file records how images are layered in that picture and why, so the code and the screens can be checked against it.

## The model

The document's own image is the first step and the **canvas**: its size, as the steps before a layer have left it, is the size of the picture at that point. A **layer** step places another image on the picture as it stands and carries on. The steps after the layer, including the effects, act on the picture with the layer in it, so an effect placed after a layer affects the layer too, and an effect placed before it does not.

A layer is on top of everything before it in the pipeline. The sidebar lists the steps with the last on top, the way layer panels do, so the row at the top of the list is the one drawn on top of the canvas and the document's image is the row at the bottom. Moving a row up moves it later in the pipeline and so closer to the viewer.

Image steps are of two kinds only: the document's image, of which there is exactly one and which is always first, and layers. There is no step that merely "opens" an image for another step to use. A step that needs a second image (boolean, join channel) names an image from the library directly, which is the same thing the document's own image and its layers do.

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

**The canvas never grows.** A layer larger than the canvas, or moved partly off it, is cut off at the canvas edge. The canvas is the document's image, as steps before the layer left it, so a resize step before a layer changes where the layer lands, and one after it scales the layer along with everything else. This is how a Background layer behaves in other editors and it keeps every render the size the person sees.

**Layers are drawn at full resolution.** The preview is made small only at the end, so placement, scale and rotation do not depend on how big the preview is.

**Compositing keeps transparency.** Transparent and partly transparent pixels in the layer, and in the picture under it, are blended by their alpha, so a PNG with a cut-out shows what is behind it. The canvas shows a checkerboard behind the picture so that transparency can be seen, and exporting to a format that cannot hold transparency (JPEG) flattens the picture onto white.

## How it is rendered

The planner turns the pipeline into a base image and an ordered list of engine steps: Sharp steps, and layers with their image resolved to a file. The engine applies them in order. Sharp does not run its operations in the order they are listed within one pipeline (it resizes before it composites, for instance), so the engine renders the picture to pixels at every layer and builds the next stage from those pixels. The layer's image is oriented, sized by `fit` and `scale`, rotated, given its opacity, cut to the part that is over the canvas, and composited with its blend mode.

Render keys name an image by its content hash and a layer by its settings, so the same document on another machine, with the same pictures under other ids, finds the same keys. That is what lets a document file bring its AI results with it.

## What changed from the earlier model

The earlier model let a document hold several "Open image" steps, of which the first was the picture and the rest were available to later steps as second images. Those extra steps showed nothing. They are now layers, and the Composite tool, which did the same job with a list of images in its options, is not offered in documents any more (the workflow editor and the `sharp` command keep it, since they have no layers).

Existing documents are migrated once: each extra image step that nothing else uses becomes a layer; an extra image step that only supplied a second image to a boolean or join channel step is dropped, since those steps name their image themselves; each Composite step becomes one layer per image, with its blend mode and placement carried over; a step that sat before the document's image is moved after it; and the undo history of a migrated document is cleared because step positions move. A document with no image step at all cannot be migrated, and the migration stops naming it.

## Where it lives

| Concern                      | Place                                                               |
| ---------------------------- | ------------------------------------------------------------------- |
| Step schemas and constraints | `src/features/pipeline/pipeline.ts`                                 |
| Changes and undo             | `src/features/pipeline/document-change.ts`                          |
| Placement maths (pure)       | `src/server/render/layer-geometry.ts`                               |
| Compositing                  | `src/server/tools/layer-compositor.ts`, called by `image-engine.ts` |
| Planning and render keys     | `src/server/render/plan-pipeline.ts`, `render-key.ts`               |
| Migration                    | `migrations/20260101000500-layers.ts`                               |
| Sidebar, options, canvas     | `src/features/documents/`, `src/features/tools/step-options.tsx`    |
| CLI                          | `scripts/images/commands/document-step.ts`                          |
