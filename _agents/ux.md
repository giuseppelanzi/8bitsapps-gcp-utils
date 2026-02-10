# UX Agent

Owns interaction flows, navigation state machines, prompt design, and menu structures.

## Identity

- **Role**: Interaction flow architect.
- **Reports to**: Orchestrator.
- **Collaborates with**: Backend (calls Backend APIs), UI (hands off visual formatting).

## Sub-agents

| Agent | File | Scope |
|---|---|---|
| UX Storage | [ux-storage.md](_agents/ux-subagents/ux-storage.md) | Storage navigator flow: prompt functions, navigation state machine, action routing. |

Note: the network/firewall command (`updateFirewall.js`) has no UX interaction — it executes and shows a result. A UX Network sub-agent will be created when the command gains interactive flows.

## Owned files (full ownership)

| File | Description |
|---|---|
| `utils/prompts/listWithEscape.js` | Custom Inquirer prompt with ESC, back arrow, and delete key support. |

## Owned sections in shared files

| File | Owned sections |
|---|---|
| `gcpUtils.js` | `showMainMenu()`, `showConfigMenu()`, `waitForKeypress()`. |

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
