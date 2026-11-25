# Glossary

Every word below has one meaning, in code, docs, the UI, the CLI and conversation. "File" is not used on its own: it could mean a Source, a Document, a Document file or a Render. **Status** says whether the thing is built or is planned in [the to-do list](workflow-pipeline-todo.md); a planned term is used for that work from now on, and the term it replaces is listed with it.

## People and data

| Term         | Means | Lives in | Status |
| ------------ | ----- | -------- | ------ |
| **User**     | A signed-in person. Owns Documents, Workflows and Sources. | SQLite, managed by Better Auth | Built |
| **Actor**    | The User a service call acts for. The website takes it from the session; the CLI takes it from `--user`, since the CLI has no account of its own. | Passed into every service call | Built |
| **Source**   | An image the User uploaded to the server, identified by its content hash. Never modified. | `.data/sources/<content hash>` on the server's disk | Built |
| **Library**  | A User's Sources, as the website's image picker and the CLI's `source` commands list them. | SQLite and `.data/sources/` | Built |
| **Document** | The editable thing, like a PSD: a permanent id, its owner, its Pipeline and its Edit history. | SQLite | Built |
| **Workflow** | A reusable Pipeline, with a Canvas like a Document's, that runs on many Sources: its Pipeline, its Canvas size mode, its Inputs and its Output settings, with an Edit history kept as a Document's is. | SQLite | Built |

## Pipelines and steps

| Term | Means | Lives in | Status |
| ---- | ----- | -------- | ------ |
| **Pipeline** | The Canvas of a Document or Workflow and its ordered Steps. Each Step acts on the picture the Steps before it made, starting from the blank Canvas; layers are drawn on top. | Inside the Document or Workflow | Built |
| **Canvas** | The width, height and background the Steps are drawn on. Stored in the Pipeline, set when the Document is made and changed only by the person. | Inside the Pipeline | Built |
| **Step** | One item in a Pipeline: a layer, a Sharp tool, an AI tool or a group, with its options and an on/off switch. Boolean and join channel Steps name their second image themselves. | Inside the Pipeline | Built |
| **Step kind** | What a Step is (`sharp`, `ai`, `group`, or a Layer kind). Its registry entry says how a Step of that kind is validated, planned and shown, and how it is copied into a Document and into a Workflow (its context rules). | The step-kind and layer-kind registries | Built; context rules planned |
| **Sharp tool** | A Step that runs one Sharp operation (geometry, filter or colour). Composite is not one: layers do what it did. | Inside the Pipeline | Built |
| **AI tool** | A Step that runs a model, on the GPU by default. Upscale is the first; others (such as background removal) are added by registering them. | The AI tool registry | Built |
| **Layer** | A Step that draws a picture over the picture so far, placed with its Placement settings. Its Layer kind says where the picture comes from. | Inside the Pipeline | Built |
| **Layer kind** | Which layer a Layer is: Image layer, Document layer or Workflow layer. A registry owns validation, image ownership, planning and sidebar display; no consumer checks for a kind directly. | `src/features/pipeline/layer-kinds` | `image` built; `document` and `workflow` planned |
| **Image layer** | A Layer that draws one Source. It may be empty: it keeps all its settings and draws nothing until it has an image. Formerly just "layer". | Inside the Pipeline | Built |
| **Document layer** | A Layer that uses another Document: it draws that Document's current picture at its parent's Canvas size. Shown as one row; clicking it opens that Document, whose changes go on its own Edit history. | Inside the Pipeline, pointing at a Document | Planned |
| **Workflow layer** | A Layer that uses a Workflow, with an image of its own for the Workflow's Input slot. Like a Document layer, it draws the Workflow's current picture, is one row, opens the Workflow when clicked and is never edited in place. The Workflow's Output settings are ignored. | Inside the Pipeline, pointing at a Workflow | Planned |
| **Placement settings** | Fit, scale, rotation, anchor, x, y, opacity and blend: where and how a picture is put on the Canvas. Defined once and used by every Layer kind and by Embedded document layers. | Inside the Step | Built |
| **Group** | A named run of Steps that is switched, moved and removed as one. The picture is made as if its Steps were not grouped, so they act on everything drawn before them. Holds Steps and Groups (planned), never an Embedded document layer. | Inside the Pipeline | Built; nesting planned |
| **Embedded document layer** | A Document inside its parent's Pipeline: a blank Canvas the size of the parent's, which its own Steps draw on and act on, placed on the parent like a Layer with Placement settings. Holds Steps, Groups, Embedded document layers, Document layers and Workflow layers (planned, at most 8 levels). It is a copy: it has no id, Edit history or Library entry of its own, and its changes go on the parent's Edit history. Replaces "sub-document" and the **Own picture** switch. | Inside the Pipeline | Built as "sub-document", one level; rename and nesting planned |
| **Change** | One edit to a Pipeline or Workflow, as data (`DocumentChange`, `WorkflowChange`): the website and the CLI make the same Changes. | `document-change.ts`, `workflow-change.ts` | Built |
| **Edit history** | The undo and redo record of Changes, stored as reversible patches (a `forward` and an `inverse` Change). A Document and a Workflow keep it the same way. It is not the Visit trail. | Inside the Document or Workflow | Built |

## Workflows and runs

| Term | Means | Lives in | Status |
| ---- | ----- | -------- | ------ |
| **Inputs** | The Library images a Workflow runs on, each at most once. The Workflow previews the last one added. | Inside the Workflow | Built |
| **Input slot** | Where a Run puts each input image. Built: the Image layers that are on and have no image (the first one is filled). Planned: the first Image layer, with or without an image; every other Image layer is fixed and draws the same image in every item, as a logo would. | The Pipeline of the Workflow | Built; new rule planned |
| **Canvas size mode** | **Match each input image** (the default: the Canvas takes each input image's size and keeps its background) or **Set size** (the Canvas's own width and height for every image). An undoable Change on the Canvas node. | Inside the Workflow | Built |
| **Output settings** | How a Run writes its Results: format and options as the Export panel has them, and the widths each image is made at, for responsive images. | Inside the Workflow | Built |
| **Run** | One start of a Workflow over chosen Inputs, made of one Job per Source per Segment. It copies the Workflow's definition, so it records which canvas it drew on: the Workflow's own, or one the size of each image. Kept until the User deletes it; its Results go with it. Run again starts a new Run on the same images; Retry failed starts one on the images that failed. | SQLite | Built |
| **Segment** | A draw Segment (the layers and Sharp Steps drawn in one pass) or a single AI Step: the unit one Job of a Run executes. A Run starts and ends with a draw Segment, and the last also encodes the Output. | — | Built |

## Images the server makes and keeps

| Term | Means | Lives in | Status |
| ---- | ----- | -------- | ------ |
| **Render** | A cheap image computed from a Document or Workflow: a preview, a thumbnail or a Sharp intermediate. A cache: it can be deleted at any time and is rebuilt when missing. | `.data/render-cache/`, named by a content hash | Built |
| **Result** | An image that cost real work or that the User asked for: the output of an AI Step, an Export, or a Run. Kept until the User deletes it; never evicted. | `.data/results/`, named by a content hash | Built |
| **Export** | A Result written at full size, downloaded by the User's browser or written to a path by the CLI. | The User's machine, and kept as a Result | Built |
| **Document file** | A Document as one `.lemon` file (a zip): its name and Pipeline, the Sources it uses and its AI Step Results, stored as the original bytes under their content hashes. Opening one makes a new Document and runs no AI Step again. Not an Export. Planned: it also carries every Document and Workflow its Document and Workflow layers use, however deep, and opening it always makes new ones. | The User's machine; made by the website and the CLI through one service | Built; layers planned |
| **Job** | One piece of slow server work (a preview or thumbnail, an AI Step, an export, one Segment of one Source of a Run), queued, run by a worker pool, and recorded in SQLite with its progress. | SQLite | Built |

## The app

| Term | Means | Lives in | Status |
| ---- | ----- | -------- | ------ |
| **Front door** | The website or the CLI. Both call the same services through `createApp`, so every feature behaves the same in both. | `src/server/composition.ts` | Built |
| **Parity** | The rule that every service method and Change kind is reachable from the CLI, or has a reason it is not (`screenOnly` or `internal`). | `scripts/images/commands/parity.ts` | Built |
| **Session** | A Document or Workflow as the open tab holds it: the last state the server confirmed and the Changes still waiting to be sent. What is on screen is the confirmed state with the waiting Changes applied. Both kinds are sessions of one store. | The pipeline store, in the tab | Built |
| **Visit trail** | The pages opened in this browser tab, oldest first, so that closing one goes back to the one before it. Navigation only: it holds no Changes and is not saved on the server. | The UI store | Built |
| **Action** | Something a User can do from the menu or a key, with an id, a label, a category and the pages it applies on (`home`, `document`, `workflow`). | The action registry | Built |
| **Key binding** | The keys that do an Action, written as text such as `mod+shift+z`. Everyone starts with the defaults; a User's changes are kept on the server and hold only what differs. See [key bindings](keybindings.md). | `default-bindings.json`; SQLite (`keybindings`) | Built |

## Rules

- **Opening an image** uploads it as a Source and creates its Document, whose Pipeline starts with an Image layer for it. Uploading the same image again finds the existing Source by its hash. The UI says "Open image", never "Open file".
- **The Document id** is permanent and is the only id the app and its routes use (`/documents/<id>`). It is the same in every browser, tab and device, and after a server restart.
- **A Source never changes or moves.** It is stored by its content hash, so there is nothing to relink and no "changed Source" state.
- **Ownership:** a User can read and change only their own Documents, Workflows and Sources. The CLI acts as an existing User.
- **Renders are a cache, not data.** Deleting all of them loses nothing.
- **Results are kept.** A Result is never evicted; it goes only when the User deletes it, or its Document or Run. Clearing unused Results removes only AI Step Results the Pipeline no longer uses; Exports are never cleared that way.
- **Cancelling a Job** ends it as cancelled and keeps any Result it already made; it queues no following Jobs.
- **Embedded or used** (planned): an Embedded document layer is a copy, edited in place, on its parent's Edit history. A Document layer or Workflow layer uses the current version of another item and is edited only in that item's own editor. Something a layer uses cannot be deleted, and no layer may lead back to the item that holds it.
