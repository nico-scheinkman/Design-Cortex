# Setup

## 1. Install the skills

The generator ships four skills under `skills/`. To make them invocable by your agent:

- **Claude Code:** copy (or symlink) each skill folder into your project's `.claude/skills/` (or `~/.claude/skills/` for all projects):
  ```bash
  cp -R skills/ds-extract skills/ds-write skills/ds-refresh skills/ds-validate \
     /path/to/your-repo/.claude/skills/
  ```
- **Cursor / other agents:** point the agent at the `skills/` folder, or paste the relevant `SKILL.md` into context. The skills are plain markdown protocols — they have no runtime dependency.

The `shared/` folder (schemas + references) is read by the skills; keep it next to `skills/` or copy it alongside.

---

## 2. Configure

Copy the template into the repo where you want the KB generated:

```bash
cp .ds-kb-config.json.example /path/to/your-repo/.ds-kb-config.json
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `figma_mcp` | yes | `official` \| `desktop` \| `console` \| a custom MCP server URL |
| `figma_file_url` | yes | The design system file to extract |
| `figma_library_urls` | no | Additional library files to include |
| `storybook_url` | no | Used to build `storybook_link` frontmatter |
| `frontend_src_path` | no | Hint for resolving `code_path` when Code Connect is absent |
| `output_path` | no | Default `./kb-output` |
| `atomic_classification` | no | `auto` (default) or `manual` |
| `freshness_warning_after_days` | no | Default `7` |
| `include_screenshots` | no | Default `false`; when `true`, saves a PNG per variant for human review |

---

## 3. MCP options

| `figma_mcp` | Endpoint | Notes |
|---|---|---|
| `official` | `https://mcp.figma.com/mcp` | Figma's hosted remote MCP |
| `desktop` | `http://127.0.0.1:3845/mcp` | Figma desktop app MCP (file must be open) |
| `console` | Figma Console MCP | Richest toolset incl. `figma_get_design_system_kit`, raw `figma_execute` fallback |
| custom URL | your server | Add a row to `skills/ds-extract/references/mcp-tool-map.md` mapping logical functions to your tools |

The extraction skill calls Figma tools **by logical function** and resolves them to the actual tool via `mcp-tool-map.md`. If your MCP uses different tool names, edit that one file.

---

## 4. Run order

1. `ds-extract` → sharded `kb-output/.cache/` (`meta.json`, `inventory.json`, `tokens.json`, `components/<slug>.json`, optional `icons-manifest.json`) + extraction report
2. `ds-write` → full `kb-output/` (runs automatically after extract, or invoke manually)
3. `ds-validate` → pass/fail report
4. `ds-refresh` → after Figma changes; preserves anything marked `source: manual`

---

## 5. Using it inside your own repo

This project is self-contained — the skills only reference files under `skills/` and `shared/`, nothing outside. To vendor it into another repo, copy the `skills/` and `shared/` folders (keep them side by side) and add your `.ds-kb-config.json`.

`kb-output/`, `.ds-kb-config.json`, and any local `Test/` artifacts are gitignored by default, so generated KBs and your private Figma file URL never get committed.
