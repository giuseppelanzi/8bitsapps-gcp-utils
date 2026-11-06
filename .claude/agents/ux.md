# UX Agent

Owns interaction flows, navigation state machines, prompt design, and menu structures.

## Identity

- **Role**: Interaction flow architect.
- **Reports to**: Orchestrator.
- **Collaborates with**: Backend (calls Backend APIs), UI (hands off visual formatting).

## Sub-agents

| Agent | File | Scope |
|---|---|---|
| UX Storage | [ux-storage.md](.claude/agents/ux-subagents/ux-storage.md) | Storage navigator flow: prompt functions, navigation state machine, action routing. |
| UX Janitor | [ux-janitor.md](.claude/agents/ux-subagents/ux-janitor.md) | Janitor navigator flow: menus, filters, navigation state, exception marking. |

Note: the network/firewall command (`updateFirewall.js`) has no UX interaction — it executes and shows a result. A UX Network sub-agent will be created when the command gains interactive flows.

## Owned files (full ownership)

| File | Description |
|---|---|
| `utils/prompts/listWithEscape.js` | Custom Inquirer prompt with ESC, back arrow, and delete key support. |
| `utils/prompts/filterableList.js` | List prompt with incremental type-to-filter and load-more pagination (ANSI escape sequences inside it are UI territory). |
| `utils/prompts/inputWithEscape.js` | Input prompt with ESC support (the screen cleanup inside `onEscape()` is UI territory). |
| `utils/prompts/passwordWithEscape.js` | Masked input prompt with ESC support, built on `inputWithEscape`; see its contract below. |

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `gcpUtils.js` | `showMainMenu()`, `showConfigMenu()` (it waits for a key when no configuration exists), `waitForKeypress()`. |
| `commands/vmConnect.js` | `showRunningVMList()` (OS column, searchable), the list loop in `execute()`, and the flow of `connectToInstance()`: identity and status checks, then `connectSsh()` for a Linux VM or `connectRdp()` for a Windows one (`guestOs`). `connectToInstance()` is shared with the janitor and never throws. `resolveKeyFile()` expands `ssh.keyFile` and checks the key pair: `execute()` calls it after listing the VMs and stops there only when none of them is Windows, since a broken pair fails every Linux VM alike; `connectSsh()` calls it again. `connectRdp()` re-validates `rdp.username` (configurations can be edited by hand), stops on a direct connection without external IP, and otherwise goes through `connectRdpThroughIap()`: tunnel, relay, `.rdp` file, client, then `watchSession()` while `listenForCancelKeys()` listens for ESC, q or Ctrl+C (it resumes the stdin a prompt left paused). Everything is closed in a `finally` whose guards are declared before the `try`, and `restoreTerminal()` removes the listener explicitly. On macOS, `offerRdpPassword()` reads the saved RDP password and copies it to the clipboard only after `openRdpFile()`, so a connection that already failed never touches the keychain; any keychain or clipboard error is a warning and the session goes on. Through IAP the clipboard is cleared at `onStarted` (which resets `changeCount` first, inside a timer: `clearSecret()` never rejects) and in the `finally`, before the tunnel closes. |
| `commands/configure.js` | `askChoice()`, `askYesNo()`, `askText()` and the other `ask…()` functions, the identity defaults (`describeLoginState()`, `adcAuthDefaults()`, `authDefaults()`), the wizard (`collectAnswers()`, `runWizard()`: modes `create`, `edit`, `duplicate`), the menu loop in `execute()`, and the delete and duplicate flows. `createConfiguration()` is shared with `init.js`. |
| `commands/init.js` | The prompt flow of `execute()`: wizard offered when no configuration exists, example written only on "No", `true` returned only when a configuration was saved. |

## Responsibilities

1. Design and implement prompt structures (inquirer question objects).
2. Define menu choices: which items appear, in what order, what values they carry.
3. Manage navigation state: pathHistory stack, back/forward/exit transitions.
4. Define action routing logic (folder enter, file select, upload, createFolder, back, delete, ESC).
5. Define input validation rules (e.g. folder name cannot contain `/`).
6. Define `enableBack` and `deleteFilter` parameters for listWithEscape prompts.

## listWithEscape contract

| Input | Return value | Meaning |
|---|---|---|
| ESC key | `null` | Exit completely. |
| Left arrow | `{ action: "back" }` | Go back one level. |
| DEL key | `{ action: "delete", value: selectedValue }` | Delete selected item. |
| Enter key | choice `value` | Normal selection. |

Configuration options:
- `enableBack` (boolean): Controls whether left arrow is active.
- `deleteFilter` (function): `(value) => boolean`, controls which items can be deleted.

## filterableList contract

Used for long, searchable listings (storage navigation, janitor inventories). Differences from listWithEscape:

| Input | Return value | Meaning |
|---|---|---|
| Printable keys (digits included) | — | Extend the filter term; the list narrows live. No jump-to-index. |
| ESC with active filter | — | Clears the filter, prompt stays open. |
| ESC with empty filter | `null` | Exit completely. |
| Left arrow | `{ action: "back" }` | Only with an empty filter; ignored otherwise. |
| DEL key | `{ action: "delete", value }` | Only when `deleteFilter` is provided and accepts the value; ignored otherwise (stricter than listWithEscape). |
| Enter on `Load more` | — | Widens the window by `pageStep`, prompt stays open. |
| Enter key | choice `value` | Normal selection. |

Configuration options:
- `source` (array): filterable items `{ name, value, search }`, `search` already lowercase.
- `footer` (array): fixed rows (choices or separators), never filtered nor counted in the window.
- `pageWindow` / `pageStep` (numbers): initial window size and load-more increment.
- `enableBack` (boolean): as in listWithEscape, but only honored with an empty filter.
- `deleteFilter` (function): as in listWithEscape, but DEL is inert when it is absent.
- `state` (object): out-param; receives `state.filterTerm` on every rebuild (used to replay the filter, e.g. CSV export).
- `formatLoadMore` / `noMatchesText` (functions): injected by callers from `utils/ui.js`, so the prompt imports no chalk.

## passwordWithEscape contract

As `inputWithEscape` (ESC returns `null`), with the value masked: one `*` per character while typing, `[hidden]` once answered (nothing for an empty answer), masked next to the spinner of async validators too, and never put back on the line after a validation error. No default is ever shown. The mask goes through `opt.transformer`, so inquirer's own `render()` keeps the layout; colors come from `utils/ui.js`, no chalk.

## inputWithEscape contract

| Input | Return value | Meaning |
|---|---|---|
| ESC key | `null` | Exit without filter nor validation; works after a validation error too. |
| Enter key | filtered answer | Normal answer, after `filter` and `validate`. An empty answer takes `default`. |

Configuration options are those of inquirer's `input`. Conventions of the configuration wizard:
- `filter: configEditor.normalizeAnswer`: trims the answer and turns `-` into `""`, so an optional field can be cleared while ENTER keeps the default.
- The SSH key file uses `configEditor.normalizeKeyFileAnswer` instead, which also drops surrounding quotes and Finder's backslash escapes. inquirer runs the filter on the default too when ENTER is pressed, so `askKeyFile()` returns an answer equal to the current value unfiltered.
- The RDP section asks `rdp.tunnelThroughIap` with `orCancel(await askYesNo(...))`, like every yes/no question (ESC must cancel the wizard, never save `null`), and `rdp.username` with `askText()` and `configEditor.validateRdpUsername`.
- The RDP password, on macOS only (`secrets.isSupported()`), is asked last in the RDP section with `passwordWithEscape`, unfiltered (spaces may belong to it). `readPasswordState()` tells with `hasRdpPassword()`, never reading the secret, whether there is one to start from: the configuration's own in edit, the source's in duplicate, none in create; a keychain error is a warning and counts as none. `askRdpPassword()` maps the answer to an action: empty → `keep` (edit), `copy` (duplicate with a source password) or `none`; `-` → `clear` (edit with a password), `keep` (edit without), `none` (create, duplicate); text → `set`. `describePasswordRow()` adds the summary row with real states (`saved`, `replaced`, `copied`, empty), "before" only in edit; a changed password alone counts as a change. `runWizard()` returns `rdpPassword` and the duplicate's `sourceName`, and `saveAndOfferLogin()` applies the action through `applyRdpPassword()` only after the file is saved; `none` also drops an orphan item left at the same path. `deleteConfiguration()` removes the item too, as a warning on error, before `offerOrphanRevoke()`.
- An empty default is passed as `undefined`, otherwise inquirer prints `()`.
- In `listWithEscape`, back and delete are on by default: `askChoice()` turns them off (`enableBack: false`, `deleteFilter: () => false`) unless the flow needs them.

## Menu prompt pattern

```javascript
const choices = items.map((item, i) => ({
  name: `${i + 1}. ${item.label}`,
  value: item.value
}));
//
const { selected } = await inquirer.prompt([{
  type: "listWithEscape",
  name: "selected",
  message: "Prompt text (ESC to exit):",
  choices,
  enableBack: false
}]);
//
return selected;
```

## Do

- Keep prompt functions as pure flow logic: define choices, call inquirer, return result.
- Use numbered choices (`${i + 1}. label`) for consistency across all menus.
- Always support ESC to exit or go back.
- Use `enableBack: false` for top-level menus, `enableBack: true` for nested navigation.
- Define clear return contracts with JSDoc `@returns` documenting all possible values including null.

## Do not

- Import chalk (UI territory). Exception: pass-through when chalk is already embedded in a choice name by UI.
- Use `process.stdout.write` with ANSI escape codes (UI territory).
- Call GCP SDK methods directly (call Backend APIs instead).
- Change the visual appearance of menu items (only their content, order, and values).
- Modify `inquirer.Separator` styling (UI territory).
