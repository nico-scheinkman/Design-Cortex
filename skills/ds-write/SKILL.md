---
name: ds-write
description: "Read the ds-extract cache and write the full Design System knowledge base. Triggers: \"write KB\", \"write the design system KB\", \"generate the KB markdown\", \"build the knowledge base from the cache\". Runs automatically after ds-extract completes. Reads ONLY the kb-output/.cache/ shards (meta/inventory/tokens/components/<slug>/icons-manifest) — zero Figma access. Fans out across a classifier subagent + parallel component/token/pattern writer subagents. Classifies every component as atom/molecule/organism (routing ambiguous ones to _review/), writes index.json, the tokens/ tree, the patterns/ tree (auto-extracted + manual scaffolds), and components/<level>/<Name>/{index.md, variants/<group>.md, *.png}. Do NOT use to crawl Figma — that is ds-extract. Do NOT use to diff/update an existing KB — that is ds-refresh."
license: MIT
metadata:
  version: 1.1.0
  category: design-system
  tags: figma, design-system, knowledge-base, markdown, mcp
---

# ds-write

## Overview

`ds-write` is the **writer** stage of the Design System KB Generator. It turns the raw cache produced by `ds-extract` into a structured, two-tier markdown knowledge base that any AI agent (Cursor, Claude Code) loads at session start instead of opening Figma.

**Hard rule — zero Figma access.** This skill never calls a Figma MCP tool, never reads from Figma, and never runs `figma_execute`. Everything it needs is already in the `kb-output/.cache/` shards. If a field is missing from the cache, it is missing from the KB — flag it, never invent it, never reach for Figma to fill the gap. (Crawling Figma is `ds-extract`'s job.)

**No Python, no build step.** The skill reads JSON and writes markdown + one `index.json`.

**Runs as a parallel fan-out (this is how it scales and drains the cache fast).** The write stage is pure local filesystem work with **no Figma/bridge access**, so it parallelizes freely. The orchestrator holds nothing heavy; the shards stay on disk and are read by the subagents that consume them:

1. **One classifier subagent** — reads only the `composition` fields across all `components/<slug>.json` shards + `icons-manifest.json`, builds the global graph, and writes `.cache/classification.json` (level + confidence + resolved `contains`/`composed_in` per component). This stage needs the *global* view, so it is singular and runs first.
2. **N component-writer subagents (in parallel)** — each takes a batch of shards, reads its own shard + `classification.json` + `tokens.json`, and writes that component's `index.md` + `variants/*.md`. Returns a one-line summary.
3. **Parallel leaf writers** — token-tree writer (`tokens.json` → `tokens/*.md`), patterns writer, and the `index.json` writer run concurrently with (or right after) the component writers.

The cache is a **transient staging area; the markdown KB is the product** — the goal is to drain the shards into final `.md` as fast as possible. Keep the classifier first (dependency), then everything else fans out.

### What this skill writes

```
kb-output/
  index.json                                   ← root table of contents (root-index.schema.json)
  tokens/
    color/{primitives,semantic,component-overrides}.md
    typography/{scale,roles}.md
    spacing.md
    elevation.md
    radius.md
    motion.md                                  ← only categories actually present in the cache
  patterns/
    index.md
    composition-rules.md                       ← source: auto_extracted
    layout-rules.md                            ← source: auto_extracted
    accessibility-rules.md                     ← source: auto_extracted (observed only) + manual scaffold
    [intent.md, brand-voice.md, …]             ← source: manual scaffolds from pattern-template.md
  components/
    atoms/Icon/index.md                         ← ONE collapsed manifest of all glyphs (if icons-manifest.json present)
    atoms/<Name>/index.md                       ← Tier 1
    atoms/<Name>/variants/<group>.md            ← Tier 2
    atoms/<Name>/<variant-slug>.png             ← only if screenshots present
    molecules/<Name>/…
    organisms/<Name>/…
  _review/<Name>/…                              ← components classified needs_human_review
```

### What this skill does NOT do

- Does NOT access Figma in any way (→ `ds-extract`).
- Does NOT diff against or update an existing KB (→ `ds-refresh`). It writes the KB fresh.
- Does NOT overwrite files a human authored — but a clean `ds-write` run assumes an empty `kb-output/`; if manual files already exist (e.g. `source: manual` patterns), preserve them (see Step 5).
- Does NOT validate references after writing (→ `ds-validate`).

---

## References (read before writing)

| File | When |
|---|---|
| `references/md-schema.md` | Before writing ANY `.md` file — defines every file type with a full annotated example. |
| `references/frontmatter-rules.md` | When deciding what goes in frontmatter vs body, required vs optional, and how `confidence` / `source` surface. |
| `references/atomic-classification-rules.md` | In Step 2 — the atom/molecule/organism heuristic and the `needs_human_review` triggers. |
| `../../shared/references/naming-conventions.md` | In Step 7 — slugifying folder/file names; what must NEVER be mutated. |
| `../../shared/references/confidence-levels.md` | When setting `confidence` — the source of truth for what lowers it. |
| `../../shared/references/pattern-template.md` | In Step 5 — scaffolding manual pattern files. |
| `../../shared/schemas/root-index.schema.json` | In Step 3 — `index.json` MUST conform. |
| `../../shared/schemas/component.schema.json` | The component data model behind each `index.md`. |
| `../../shared/schemas/token.schema.json` | The shape of a token entry behind each token table row. |
| `../../shared/schemas/pattern.schema.json` | The frontmatter shape of each pattern file. |
| `../../shared/schemas/raw-extract.schema.json` | The INPUT contract — the sharded-cache `$defs` (`metaFile`, `inventoryFile`, `tokensFile`, `iconsManifestFile`, `component`, `classificationFile`) you read/write. |

---

## Protocol

### Step 1 — Read the cache (sharded)

1. Read `kb-output/.cache/meta.json`. This is the entry point. If `.cache/` is missing entirely, stop and tell the user to run `ds-extract` first.
   - **Layout branch.** If `meta.cacheLayout == "sharded"` (or `.cache/inventory.json` exists), the inputs are the shards: `inventory.json`, `tokens.json`, optional `icons-manifest.json`, and one `components/<slug>.json` per set. If instead a legacy single-file `.cache/raw-extract.json` is present, read it as one object (`meta`, `components[]`, `tokenCollections[]`) — the rest of the protocol is identical, just sourced from that object.
2. Validate each shard against its `$def` in `raw-extract.schema.json` (`metaFile`, `inventoryFile`, `tokensFile`, `component`). If `meta.incomplete` is non-empty, note it — those components/passes may produce lower-confidence output, and the final report must surface them.
3. Read `meta.includeScreenshots` — if false, skip all PNG steps. Note `meta.figmaFileUrl` (and `meta.branchKey` if set) and `meta.generatedAt` for `index.json` and per-file frontmatter (`figma_link`, `last_updated`).
4. **Never hold all shards in the orchestrator.** The orchestrator reads only `meta.json` + `inventory.json` (both small) to plan the fan-out; each subagent reads the heavy shards it needs. The rest of the protocol is pure transformation — **no Figma calls anywhere from here on.**

### Step 2 — Classify every component (ONE classifier subagent → `classification.json`)

Classification needs the **global** graph — a subagent seeing only its own shard cannot decide organism-vs-molecule (rule: "contains a molecule" requires knowing other components' levels). So run this as a **single classifier subagent** that reads only the lightweight `composition` fields of every `components/<slug>.json` shard (not the variant matrices) plus `icons-manifest.json`, and writes `.cache/classification.json` (`$defs/classificationFile`). The parallel writers in Step 6 read that file instead of each re-deriving the graph.

The classifier applies `references/atomic-classification-rules.md`:

1. Compute level from the **icon-excluded** composition metrics (`nonIconInstanceCount`, `distinctNonIconChildComponents`, `maxInstanceDepth`, `unresolvedMains`) and the variant-by-variant structure. Use the icon `key` set from `icons-manifest.json` to confirm which child instances are glyphs so a `Rating` (5 stars) or `List` (12 icons) is not wrongly promoted:
   - **atom** — no non-icon child component instances (`nonIconInstanceCount == 0`).
   - **molecule** — 2–4 non-icon atom instances as direct children, no nested molecules.
   - **organism** — contains a molecule, OR 5+ non-icon atom instances, OR manages its own layout (auto-layout with structural sections).
2. Decide `confidence` per `confidence-levels.md`. Any `needs_human_review` trigger (structure varies across variants, `unresolvedMains > 0`, boundary straddle, category-not-atom) → `confidence: needs_human_review` and `category: "_review"`.
3. Build the composition graph from each shard's `composition.childComponentKeys` (or `meta.json`'s `compositionEdges[]` if present) so each component gets `contains` (children) and `composed_in` (parents). Resolve keys to component names via `inventory.json`; if a key resolves to nothing, leave the literal key and lower confidence.
4. Write one `classification.json` row per component: `key`, `name`, `slug`, `category`, `confidence`, `contains`, `composed_in`, `reason`. This file drives both `index.json` and every writer's folder path.

### Step 3 — Write `index.json`

Write `kb-output/index.json` conforming exactly to `root-index.schema.json`:

- Top level: `generated_at` (= `meta.generatedAt`), `figma_file` (= `meta.figmaFileUrl`), `storybook` (from config if available, else `null`), `freshness_warning_after_days` (from config, default 7), `token_categories` (the categories you will actually write in Step 4), `pattern_files` (the pattern filenames you will write in Step 5).
- `components[]`: one entry per component (category/contains/composed_in/confidence come from `classification.json`; ids/counts from each shard) with `name`, `category`, `path` (relative, e.g. `components/atoms/Button`), `figma_component_id` (= `nodeId`), `figma_component_key` (= stable `key`, the refresh anchor), `variant_groups` (axis names), `total_variants` (use `totalVariantCount` when the shard is `variantSampling: "sampled"`), `has_code_mapping`, `composed_in`, `confidence`.
- **Icons entry.** If `icons-manifest.json` exists, emit exactly ONE component entry for the collapsed set: `name: "Icon"`, `category: "atoms"`, `path: "components/atoms/Icon"`, with the manifest count as `total_variants` — never one entry per glyph.
- This is the table of contents a consuming agent reads first — every component MUST appear here, including `_review/` ones (with `category: "_review"`). This writer can run as its own subagent once `classification.json` exists.

### Step 4 — Write `tokens/`

Read `tokens.json` (`tokenCollections[]`), bucket variables into categories, and write one file per group. **Only write categories that actually have tokens.** This is self-contained (no component or classification dependency), so run it as its own **parallel token-tree writer subagent** alongside the component writers.

| Category folder | Group files | Source signal |
|---|---|---|
| `color/` | `primitives.md`, `semantic.md`, `component-overrides.md` | `type == COLOR`. Primitives = raw scales (no alias); semantic = resolves through a `VARIABLE_ALIAS`; component-overrides = names scoped to a component. |
| `typography/` | `scale.md`, `roles.md` | font-size/line-height/weight scales vs named roles (e.g. `heading.lg`). |
| `spacing.md` | (single file) | numeric spacing/gap/padding scale. |
| `elevation.md` | (single file) | shadow tokens. |
| `radius.md` | (single file) | corner-radius tokens. |
| `motion.md` | (single file) | duration/easing tokens. |

Each token file follows the token-file schema in `md-schema.md`: frontmatter (`category`, `group`, `token_count`) + a table with columns **Token | Resolved Value | Code Syntax | Usage**. Use `resolvedValue` for Resolved Value, `codeSyntax.WEB` (or first available) for Code Syntax, and `description` for Usage. Store the dotted token name in the table and keep the original `/`-path available via `figma_name` references (see `naming-conventions.md`). Resolve `VARIABLE_ALIAS` chains to a literal for the Resolved Value column; if a value is an unresolved alias, write the alias name and flag it.

### Step 5 — Write `patterns/`

Two kinds of pattern files (see `pattern.schema.json` + `md-schema.md`):

1. **Auto-extracted** (`source: auto_extracted`) — derived ONLY from observed structure in the cache. Never editorialize.
   - `composition-rules.md` — observed `contains` / `composed_in` edges as plain statements ("`Button` is composed inside `Controller`, `Card`").
   - `layout-rules.md` — recurring auto-layout patterns across components (common direction, padding, gap, sizing).
   - `accessibility-rules.md` — ONLY a11y facts derivable from structure (e.g. observed state axes mapping to interaction states). Everything else is a manual scaffold.
2. **Manual scaffolds** (`source: manual`) — scaffold from `../../shared/references/pattern-template.md` for the intent-level rules Figma can't express: `intent.md`, `brand-voice.md`, and the non-derivable accessibility rules. **If a `source: manual` file already exists in `patterns/`, do NOT overwrite it** — leave it untouched (this is what lets `ds-refresh` preserve human work; `ds-write` respects it too).
3. Write `patterns/index.md` listing every pattern file with its `source`, and add each filename to `index.json.pattern_files`. Patterns derive from the composition graph (`classification.json` / edges) + auto-layout across shards, so this runs as its own **parallel patterns-writer subagent** once `classification.json` exists.

### Step 6 — Write components (Tier 1 + Tier 2) — **fan out across writer subagents**

This is the bulk of the work and it parallelizes. Once `classification.json` exists, the orchestrator batches the component shards (~10–15 per subagent) and dispatches **N writer subagents in parallel**. Each subagent reads its batch's shards + `classification.json` + `tokens.json`, writes the files below, and returns a one-line summary (`"<batch>: K components written"`). No bridge, no contention — this is the safe, high-throughput use of parallelism that drains the cache fast.

**Icon manifest (collapse, do not expand).** If `icons-manifest.json` exists, one writer emits a **single** `components/atoms/Icon/index.md` containing a manifest table (`Name | Key | Node ID | Size`) of all glyphs — never one folder per icon. Note in the file that individual glyphs are addressed by key from this table. This is the render half of the extract-side icon collapse.

For each non-icon component, at `components/<category>/<Name>/` (or `_review/<Name>/`):

1. **`index.md` (Tier 1)** — full frontmatter + body sections per the component-index schema in `md-schema.md`: description, Anatomy, Variant Groups table, Total Variants, When to Use, When NOT to Use, Composition Notes, Auto-Layout, Accessibility. Use the proven shape — a Variants table with **per-node Figma node + key**, a variant-axis block, sub-components composed, and "Where it's used".
2. **`variants/<group>.md` (Tier 2)** — one file per variant axis (kebab-case of the property name). Frontmatter (`component`, `variant_group`, `figma_property_name`, `figma_property_type`, `options`) + a body block per option: usage, background/label tokens **with resolved values**, states, and `Code prop:`.
3. **Per-variant PNGs** — only if `screenshots` is present on the component and `meta.includeScreenshots` is true. Copy/reference the PNG beside `index.md` as `<variant-slug>.png`; reference it from `index.md` so it is graph-reachable.
4. **Preserve verbatim** — variant value strings (used to set `componentProperties`, including deliberate missing spaces like `Label +Full width Input`), hash-suffixed property keys (`Label#a1b2c3`), component keys, and node ids are copied EXACTLY from the cache. Never normalize them in body text — only folder/file paths are slugified.
5. **Surface sampled matrices as partial.** If a shard is `variantSampling: "sampled"`, the variant table lists the sample rows but the header states the true `totalVariantCount` and notes "showing a representative sample of N of M variants" — never present a sampled matrix as complete.
6. **Graph health** — every file must be reachable by a body-text markdown link from its parent: `index.md` links to each `variants/*.md` and each PNG; `index.json`/`patterns/index.md` are the entry points. Never rely on frontmatter alone for reachability.

### Step 7 — Slugify names

Apply `../../shared/references/naming-conventions.md` for all paths:

- Component folder: strip leading status/category emoji (`✅ `, `🚫 `, `⚡ `, `💠`), PascalCase the COMPONENT_SET name, drop spaces/punctuation. `Section Header` → `SectionHeader/`.
- Variant group file: kebab-case the property name. `Icon Position` → `icon-position.md`.
- Replace `/` with `-`, collapse repeated separators, trim. Handle Unicode/emoji deterministically (transliterate or drop, never leave a raw emoji in a path).
- On a slug collision, append a short disambiguator from `page`.
- **Never** mutate variant value strings, keys, node ids, or token names — those live verbatim in the file bodies/frontmatter.

### Step 8 — Report

Collect the one-line summaries from every writer subagent, then print a concise write report:
- Components written per level (atoms / molecules / organisms) and how many landed in `_review/`.
- Icons collapsed into the single `Icon/` manifest (count), if any.
- Components whose matrix was `variantSampling: "sampled"` (shown partial), with the true totals.
- Token categories + total token count written.
- Pattern files written (auto vs manual scaffold) and any manual files preserved.
- Components with `confidence` below `high`, with the reason (carried from `confidence-levels.md` triggers).
- Anything from `meta.incomplete` that produced partial output.
- Reminder to run `ds-validate` next.

---

## Confidence & "not extractable" discipline

- `confidence` is computed in Step 2 and surfaced in BOTH `index.json` and each `index.md` frontmatter (see `confidence-levels.md`).
- Fields with no Figma source are represented explicitly, never invented: `deprecated_by: null` (unless a name prefix like `🚫` flags it for human confirmation), `similar_to: []`, and synthesized intent sections (When to Use / When NOT to Use) are marked as synthesized and cap the component at `medium` (or lower).
- Unbound colors are written as the literal value with `token: null` — never back-filled with a guessed token name.

---

## Quick reference

| Task | Source in the sharded cache |
|---|---|
| Component name / level | `classification.json` (level/confidence) + shard `composition` (non-icon) metrics |
| Variant matrix (node + key) | `components/<slug>.json` → `variants[].{nodeId,key,name,props}` (+ `variantSampling`/`totalVariantCount`) |
| Token table row | `tokens.json` → `tokenCollections[].variables[].{name,resolvedValue,codeSyntax,description}` |
| Composition graph | `classification.json` `contains`/`composed_in` (or `meta.json` `compositionEdges[]` + shard `composition.childComponentKeys`) |
| Icons (collapsed) | `icons-manifest.json` → single `Icon/` manifest entry |
| Auto-layout block | `components/<slug>.json` → `autoLayout` |
| Code mapping | `components/<slug>.json` → `codeMapping` |
| Screenshots | `components/<slug>.json` → `screenshots` (only if `meta.includeScreenshots`) |
| Deprecation signal | `components/<slug>.json` → `flags.namePrefix` |
