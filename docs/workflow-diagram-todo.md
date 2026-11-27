# Workflow diagram to-do

A list of what needs doing, in build order, not a plan. A workflow's diagram is drawn from its pipeline's step order (`src/features/workflows/workflow-graph-layout.ts`), and nodes cannot be dragged (`nodesDraggable={false}` in `workflow-canvas.tsx`): the only way to move a step is **Move earlier** and **Move later** in the options panel. This adds dragging a step node to a new place in the order. Every item is built test first, and `tsc`, `biome check .`, Vitest and the Playwright run pass at the end of each section.

## Decisions

| #   | Decision            | Rule                                                                                                                                                                                                                                                                                             |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Order, not position | Dragging a node changes its place in the pipeline, not where it is drawn: on drop the diagram lays itself out again and the node takes its new place. No x or y is stored, since the left-to-right order is what the pipeline means and the CLI has no use for positions.                        |
| 2   | One change          | A drop makes the existing `move-step` change (`stepId`, `to`, `parentId`), the one the Move earlier and Move later buttons make, so undo, validation and live updates are already the core's. The website and the CLI only translate input into it.                                              |
| 3   | Drop targets        | While dragging, a marker shows where the node will go: between two nodes of a row, at either end of a row, or inside a group or embedded document frame, including an empty one. Dropping where nothing changes, or outside the diagram, makes no change.                                        |
| 4   | Fixed nodes         | Canvas, Inputs and Output cannot be dragged and are not drop targets. A frame (group or embedded document layer) can be dragged as a whole, with its steps, and cannot be dropped into itself or a frame inside it. The Input layer can be dragged (input layer to-do, decision 1, input layer). |
| 5   | Keyboard            | Moving a selected node by keyboard uses the existing `step.moveUp` and `step.moveDown` actions (Alt+] and Alt+[), on the diagram as in the document editor, crossing into and out of frames as the buttons do.                                                                                   |

## 1. Drop target logic

- [ ] Tests first, pure functions with no React: from the laid-out graph and a pointer position, the drop target is the slot between the two nearest nodes of the row under the pointer, the start or end of a row, or the inside of the frame under the pointer, at any depth; a frame is not a target for itself or its own descendants; a target equal to the node's current place is none; Canvas, Inputs and Output are never targets (decisions 3 and 4, drop targets and fixed nodes).
- [ ] A module beside `workflow-graph-layout.ts` that turns a target into a `move-step` change (decision 2, one change), indices counted as `applyChange` counts them after the step leaves its list.

## 2. Dragging on the diagram

- [ ] Tests first (component tests, then Playwright): dragging a step after another moves it there and the order survives a reload; dragging into a group puts it inside; dragging a group moves its steps with it; Undo puts it back; dragging Canvas, Inputs or Output does nothing; the marker shows while dragging and goes away on drop or Escape.
- [ ] Turn dragging on for step and frame nodes only, with React Flow's `onNodeDrag` and `onNodeDragStop`; the drop marker is a small shared part that knows nothing about step kinds; on drop the node returns to the layout and the change is sent.
- [ ] Dragging must not fight the canvas pan, selection or the delete button (`nodrag` on controls stays).
- [ ] Screenshots of a drag in progress and after a drop, checked with the Playwright MCP.

## 3. Keyboard and parity

- [ ] Tests first: with a node selected on the diagram, `step.moveUp` and `step.moveDown` move it, into and out of frames (decision 5, keyboard).
- [ ] Wire the actions on the workflow page if they are not already.
- [ ] Check `scripts/images/commands/parity.ts`: a workflow's `move-step` must be reachable from the CLI as a document's is (`document step move`); add the workflow command if it is missing, with `schema` and the README.

## 4. Done when

- [ ] Vitest, `tsc`, `biome check .`, `pnpm build` and the Playwright run (on the production build) all pass.
- [ ] A step can be moved anywhere in a workflow, including into and out of frames, by dragging, by keyboard and from the CLI, and each is one undoable change.
