# Lemonify

## The website and the command line have exactly the same features

Both are thin front doors over the same core, `createApp` in `src/server/composition.ts`, so how a feature behaves is decided once. What the core cannot guarantee is that each feature is reachable from both, so:

- **Build every feature for both in the same change.** A new service method, `DocumentChange` kind, step kind, setting or option gets its CLI command (`scripts/images/commands/`) and its website control together. Neither ships alone, and no feature is left for later.
- **Register it in `scripts/images/commands/parity.ts`.** The tables there map each `DocumentChange` kind and every public method of every service to the command that reaches it, or to a reason it has none (`screenOnly` or `internal`). A method with no entry is a type error, and `parity.test.ts` fails if a table is out of date, a method has no command or reason, or a command it names is not registered. Add the website control and the CLI command in the same change.
- **Put the rules in the core, not in a front door.** Validation, ownership, undo and rendering belong in the services and `src/features/pipeline`; the website and the CLI only translate their input into those calls and print the result.
- **What has no CLI equivalent is only what is about the screen:** canvas zoom and pan, the navigator, panel layout, sidebar state, and live updates to open tabs. Everything saved in a document, and everything that changes the picture, is available in both.
- **Update `schema` and the docs with the feature,** so scripts can discover it.

## React components are composable

- **Compose, don't configure.** Build a component from small parts that the caller assembles (`<Stack><Row/><Row/></Stack>`), not from one component that takes a list of options or a mode and decides the layout itself. A new case is a new arrangement of the same parts, not a new branch inside one of them.
- **Keep what varies out of the shared parts.** A shared part knows its layout, state and accessibility, and nothing about the tool, step kind or feature that uses it. What differs (names, which picture, what a click does) comes in as props or children, or from a registry entry like `src/features/pipeline/layer-kinds` and `src/features/overlay/overlay-tools.ts`, where the feature says how.
- **Do not assume the one case you are building.** If the design says other tools or step kinds will use a component, nothing in it may be written for the first one (labels, step ops, wording).
