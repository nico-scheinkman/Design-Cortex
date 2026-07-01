# MCP Tool Map

The single source of truth for **which actual tool name** implements each **logical function** the skills need, per MCP profile.

## The contract

> **Skills NEVER hardcode a tool name.** They reference a *logical function* (e.g. "Component structure + variants"). This file is the **only** place the mapping from logical function → real tool name lives.

Why this matters: the same extraction pipeline runs against four different Figma MCP backends. Each backend exposes different tool names for the same capability. By indirecting through this table, the SKILL.md protocol stays identical regardless of which MCP the user configured in `.ds-kb-config.json` → `figma_mcp`.

When a user adds a **custom** MCP, they edit *only this file* — fill in the `custom` column — and every skill works unchanged.

---

## The map

`.ds-kb-config.json` → `figma_mcp` selects the column: `official` | `desktop` | `console` | `custom`.

| Logical function | `official` | `desktop` | `console` | `custom` | Extracts |
|---|---|---|---|---|---|
| **Component structure + variants** | `get_design_context` | `get_design_context` | `figma_get_component_details` / `figma_get_component_for_development_deep` | _user fills in_ | Node tree, variant property defs, full variant matrix, auto-layout, applied styles, description, descendant instances |
| **Lightweight inventory** | `get_metadata` | `get_metadata` | `figma_get_design_system_summary` | _user fills in_ | ids, keys, names, types, sizes — the work queue |
| **Tokens + styles** | `get_variable_defs` | `get_variable_defs` | `figma_get_variables` / `figma_get_styles` / `figma_get_token_values` | _user fills in_ | Variables, collections, modes, resolved values, configured code syntax, shared styles |
| **Whole-system one-shot** | _(none — skip to per-component)_ | _(none — skip to per-component)_ | `figma_get_design_system_kit` | _user fills in_ | Tokens + components + styles in a single call |
| **Code mapping** | `get_code_connect_map` | `get_code_connect_map` | `figma_get_component_for_development` | _user fills in_ | Figma id → code component name, file path, props |
| **Visual reference** | `get_screenshot` | `get_screenshot` | `figma_get_component_image` / `figma_take_screenshot` | _user fills in_ | Per-variant PNG |
| **Search** | _(library search via `get_metadata` scan)_ | _(library search via `get_metadata` scan)_ | `figma_search_components` | _user fills in_ | Find a component/set by name |
| **Raw escape hatch** | _(none)_ | _(none)_ | `figma_execute` | _user fills in_ | Arbitrary Plugin-API JS for fields the semantic tools omit — **last resort only** |

---

## Profile notes

### `official` — Figma's hosted MCP (`mcp.figma.com`)
The canonical Figma MCP. Tool names are the short semantic verbs (`get_design_context`, `get_metadata`, `get_variable_defs`, `get_code_connect_map`, `get_screenshot`). **No whole-system one-shot and no raw `figma_execute` escape hatch** — the extractor skips step 2 (one-shot) entirely and goes straight to per-component, and any field the semantic tools omit is flagged (see `extraction-rules.md` §Not reliably extractable) rather than recovered via JS.

### `desktop` — Figma Desktop local server (`127.0.0.1:3845`)
Tool names **mirror `official` exactly** (it is the same Figma MCP surface, served locally by the desktop app's Dev Mode MCP server). Treat the `desktop` column as identical to `official`. Same limitation: no one-shot, no raw escape hatch.

### `console` — Figma Console MCP (the verified default)
The richest surface and the **only profile with both `figma_get_design_system_kit` (one-shot) and `figma_execute` (raw escape hatch)**. This is the profile this toolkit was built and verified against. The mapping above is verified against the connected `figma-console` MCP. Two depths exist for component structure:
- `figma_get_component_details` — standard depth (variant defs + matrix + one level of layers).
- `figma_get_component_for_development_deep` — full descendant tree (use when composition inference needs nested instance mains).

### `custom` — any other MCP
The user fills in the `custom` column with their MCP's tool names. If their MCP lacks a capability (e.g. no one-shot, no raw JS), they leave that cell blank and the skill degrades gracefully:
- No **whole-system one-shot** → skip step 2, always per-component.
- No **raw escape hatch** → cannot recover omitted fields; flag them per `extraction-rules.md`.
- No **code mapping** → every component gets `has_code_mapping: false`; listed under `missingCodeMapping`.

---

## Capability matrix (what degrades when a cell is blank)

| Capability | If present | If absent |
|---|---|---|
| Whole-system one-shot | Try once; page-fallback if oversized | Skip step 2; go straight to per-component (step 3) |
| Raw escape hatch (`figma_execute`) | Recover `boundVariables`, deep instance mains, `componentPropertyDefinitions` the semantic tools dropped | Flag the missing field; never invent it |
| Code mapping | Populate `codeMapping` per component | `codeMapping: null`; component listed in `report.missingCodeMapping` |
| Visual reference | Per-variant PNGs when `include_screenshots: true` | Skip screenshots; note in report |

---

## How a skill uses this file

1. Read `figma_mcp` from `.ds-kb-config.json`.
2. For each pipeline step, look up the **logical function** in the table above and resolve the actual tool name from the matching column.
3. If the cell is blank, consult the **capability matrix** for the degradation path.
4. Call the resolved tool. Never reference a literal tool name in the protocol prose — always go through the logical function.
