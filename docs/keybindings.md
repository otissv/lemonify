# Key bindings

Every action in the editor that a key can do, such as undo, opening an image, grouping steps, zooming, showing a panel or adding a tool, has a stable id and a label, and any of them can be bound to keys. Everyone starts with the same defaults, kept in a JSON file in the repository. Each person can change them, and their changes are kept on the server, so they follow the person to every browser and to the command line. The website and the command line reach the same feature: the Keyboard shortcuts dialog (Help menu, or the key for `help.shortcuts`) and the `keys` commands both call `KeybindingService`.

## What a binding is

A binding is text: the modifiers `mod`, `alt` and `shift`, then one key, joined with `+`, as in `mod+shift+z`, `alt+g` or `delete`. `mod` means Ctrl on Windows and Linux and Cmd on a Mac, so one binding serves every system. The key is the physical key (`KeyboardEvent.code`), not the character it types, so a binding means the same key on every keyboard layout and `shift+equal` is the key that types `+` on a US keyboard. Text is always written in one canonical order, `mod+alt+shift+key`, so two spellings of one binding compare equal. The keys that can be named are the letters, the digits, `f1` to `f12`, the arrows, `home`, `end`, `pageup`, `pagedown`, `enter`, `escape`, `space`, `tab`, `backspace`, `delete`, the punctuation keys (`minus`, `equal`, `comma`, `period`, `slash`, `backslash`, `semicolon`, `quote`, `backquote`, `bracketleft`, `bracketright`) and `numpadadd` and `numpadsubtract`. The grammar, the checks and the way keys are shown and announced live in `src/features/keybindings/binding.ts`.

An action has a list of up to four bindings. An empty list means the action has no key. A User's list for an action replaces the default list as a whole; it is never merged with it.

## Keys the page cannot have

The browser keeps some keys for itself, and a page can neither receive nor reliably cancel them: opening, closing and switching tabs and windows (`mod+t`, `mod+w`, `mod+n`, `mod+shift+t`, `mod+1` to `mod+9`, `mod+tab`), reloading, the address bar, find, print, save, history navigation (`alt+arrowleft`, and `mod+[` and `mod+]` on a Mac), the browser menu (`alt+e`, `alt+f`), browser zoom (`mod+plus`, `mod+minus`, `mod+0`) and the function keys the browser uses. These are refused by name, with the reason, wherever a binding enters the system: the defaults file, the server, the command line and the dialog. Bare `enter`, `space`, `tab` and `escape` (and the same with `shift`) are refused too, because they already activate buttons, move focus and close dialogs. The list is `BROWSER_KEPT` in `binding.ts`; a test checks that the defaults use none of it.

The default scheme follows the single-letter tool keys of Figma and similar browser tools, not Photoshop's, because a browser app cannot use Photoshop's `mod` combinations. Commands that would otherwise need a browser-kept combination use `alt` instead (`alt+o` opens an image, `alt+x` exports).

## Defaults and changes

The defaults are `src/features/keybindings/default-bindings.json`: `{ "version": 1, "bindings": { "<action id>": ["<binding>", …] } }`. Changing a default for everyone is editing that file. The file is read through the same Zod schema as a User's changes (`keybindings-file.ts`), at startup, so a mistake stops the app from starting and is also caught by `defaults.test.ts`, which checks that every id is an action, that no key belongs to two actions and that no key is one the browser keeps.

A User's changes are the same JSON, holding only what differs from the defaults, one row per User in the `keybindings` table (`owner_id`, `bindings`, `updated_at`; the row goes when the User does). Storing only differences means a default that changes later reaches everyone who did not change that action. The keys in force are worked out by `effectiveBindings`: a User's list wins for the actions they changed, and a default key that the User has given to a different action is dropped from the action that had it by default, so a later change to the defaults can never put one key on two actions.

Saving always replaces the whole set of changes and checks it as one unit. A key that would belong to two actions after the change is refused with the names of the actions. To move a key from one action to another, the dialog saves both changes in one file (the "Move it here" button), and `keys import` can do the same; the one-action commands refuse until the key is given up first. Entries identical to the defaults are dropped before storing, and an empty set removes the row. `save`, `set` and `reset` tell the User's other open tabs (`keybindings.changed`, see [live updates](live-updates.md)), which read the keys again.

## Defence in depth

The same rules are checked in several places because each place can be reached on its own. The Zod schema refuses unknown action ids (including `__proto__`), malformed or browser-kept bindings, more than four bindings for an action, and any field it does not know. The server function validates the body, then `KeybindingService` validates it again, normalises it and checks conflicts; neither trusts the other. The data access layer parses what it reads back, so a damaged row raises a data integrity error and is never partly used. The routes are behind the session middleware and the rate limit like every other server function, a User can read and write only their own row because the row is addressed by the signed-in User and never by a client-supplied id, and the file can hold only registered actions with at most four short bindings each, so its size is bounded without a separate limit. On the page, a key press is ignored when something else already handled it, while text is being composed, while the focus is in a text field, a menu, a list, a slider, tabs or a dialog, and while a key is held unless the action is one that repeats (panning, zooming, moving steps). A key is taken from the browser only when its action actually ran, so a key whose action cannot apply right now, such as undo with nothing to undo, still does what the browser does with it.

## Where each part lives

The action registry (`actions.ts`) lists every action with its id, label, group and whether holding the key repeats; the tool actions (`tool.sharp.<operation>` and `tool.ai.<id>`) are generated from the same lists the tool browser uses, so a new tool gets an action and can be bound without further work. `action-runner.ts` is the one place that says whether an action can run right now and what it does; the menu items, the toolbar buttons and the keys all call it, so they cannot disagree. `key-dispatch.ts` turns a key press into an action, `use-key-bindings.ts` listens for it, and `KeyBindings` mounts the listener on each page (a document's page passes the AI catalogues so that tool keys can add AI steps). The menu and tooltips show the first key of each action and announce all of them through `aria-keyshortcuts`. The dialog is `shortcuts-dialog.tsx`; its edits are worked out by the pure functions in `keybinding-edit.ts`.

Shortcuts are remappable and can be removed, which is what WCAG 2.1.4 (Character Key Shortcuts) asks of single-character shortcuts. The dialog is reachable from the keyboard, announces its states, and works without the pointer. Adding an action means adding it to the registry, giving it a default if it should have one, handling it in the runner, and updating the command-line parity tables in the same change.

## Command line

```bash
pnpm images keys list                      # every action with its keys; * marks what you changed
pnpm images keys set view.fit alt+f        # replace an action's keys; several, separated by commas
pnpm images keys unset edit.redo           # leave an action with no key
pnpm images keys reset edit.redo           # back to the defaults; no id resets everything
pnpm images keys export > mine.json        # your changes, as a file
pnpm images keys import --bindings @mine.json
```

Like every stateful command these act as `--user <name>` (or `LEMONIFY_USER`, or the only user), and `--json` prints the changes, the keys in force and when they were saved. `pnpm images schema "keys import"` prints the schema of the options.
