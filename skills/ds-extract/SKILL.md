---
name: ds-extract
description: "Extract a Figma design system into a structured raw cache that ds-write turns into a markdown knowledge base. MCP-native, no Python and no API keys — extraction is done by calling Figma MCP tools. Use when the user says \"build my KB\", \"build my design system KB\", \"extract my design system\", \"generate the design system knowledge base\", \"run the DS extractor\", \"run ds-extract\", or simply \"run\" inside a ds-kb-generator project. Crawls the configured Figma file (inventory → whole-system one-shot with paging fallback → deep per-component → tokens → composition → code mapping → optional screenshots), persisting stable component keys and flagging anything Figma does not encode, then writes a sharded cache under kb-output/.cache/ (meta.json, inventory.json, tokens.json, components/<slug>.json, optional icons-manifest.json) via batched extraction subagents and hands off to ds-write. Does NOT write the final markdown KB (that is ds-write) and never modifies the Figma file."
license: MIT
metadata:
  version: 1.1.0
  category: design-system
  tags: figma, design-system, extraction, knowledge-base, mcp
---

# ds-extract

## Overview

`ds-extract` is the **read** half of the Design System KB Generator. It crawls a Figma design system through whatever Figma MCP the user has configured, and writes a **sharded cache** under `kb-output/.cache/` (each file conforms to a `$def` in `shared/schemas/raw-extract.schema.json`). It then hands off to `ds-write`, which turns that cache into the markdown KB **with zero further Figma access**.

**Why sharded (the thing that makes large systems possible).** The Figma plugin sandbox has no filesystem, so the only way data reaches disk is by the MCP returning it through the agent's context. A ~5,000-variant system is multiple MB — larger than one context window — so "extract everything into one `raw-extract.json` held in the orchestrator" does **not** scale. Instead the cache is split so nothing heavy ever sits in the orchestrator:

```
kb-output/.cache/
  meta.json             ← run meta + global composition graph + report (small; orchestrator may hold this)
  inventory.json        ← the work queue: every COMPONENT / COMPONENT_SET, one lightweight row each
  tokens.json           ← all token collections
  icons-manifest.json   ← ONE collapsed entry for a large flat glyph set (only if icons detected)
  components/<slug>.json ← ONE component set per file — the heavy variant matrices live here
```

**And extraction runs in subagents.** Each extraction subagent pulls a *batch* of components with **one** `figma_execute`, writes its own `components/<slug>.json` shards to disk, and returns only a **one-line summary** to the orchestrator. The heavy JSON never round-trips through the orchestrator's context. This is the single change that lifts the cap on addressable system size (see Step 3).

**What this skill does:**
- Inventories every COMPONENT / COMPONENT_SET in the configured file.
- Extracts variant matrices, non-variant property defs, auto-layout, applied styles, descriptions, and descendant-instance composition metrics.
- Extracts token collections, modes, resolved values, and configured code syntax.
- Maps each component to its Code Connect code component / path / props.
- Optionally captures per-variant screenshots.
- Persists the **stable component `key`** alongside every node id, flags everything Figma doesn't encode, and prints an extraction report.

**What this skill does NOT do:**
- It does **not** write the final markdown KB (`index.json`, `components/`, `tokens/`, `patterns/`) — that is **`ds-write`**. (It writes only the `.cache/` shards.)
- It does **not** classify atom/molecule/organism — it captures the raw metrics; `ds-write` classifies.
- It does **not** modify the Figma file in any way. Read-only.
- It does **not** invent intent, accessibility, deprecation, or token data — missing data is **flagged**, never filled from memory.

**Reference files (read as needed):**
- `references/mcp-tool-map.md` — logical function → real tool name, per MCP profile. **The only place tool names live.**
- `references/extraction-rules.md` — normalization, paging-fallback decision, not-extractable table, composition metrics, `figma_execute` recipes.
- `../../shared/schemas/raw-extract.schema.json` — the exact output contract.
- `../../shared/references/naming-conventions.md` — verbatim-preservation rules (the extractor preserves; `ds-write` slugs).
- `../../shared/references/confidence-levels.md` — what the report flags so the user knows what `ds-write` will down-rank.

---

## The Three Safeguards (non-negotiable, baked into every step)

These run through the entire pipeline. Violating any of them silently corrupts the KB.

1. **Key-anchoring.** Persist the stable published component `key` alongside the session `nodeId` for *every* component, variant, and token. **Node ids are session-specific and change between sessions; keys do not.** Refresh re-anchors by key. A component whose `key` came back empty is itself a flag → list it in the report.
2. **Response-size paging fallback.** The whole-system one-shot can exceed the MCP response cap and return a *silently truncated* result. Always reconcile its output against the inventory work queue; on oversize or short count, fall back to per-component extraction (full procedure in `extraction-rules.md §2`).
3. **Not-extractable → flag, never invent.** Intent, most accessibility, `similar_to`, deprecation, composition *rules*, and unbound colors are not in Figma's data model. Emit a flagged placeholder (or capture only the derivable signal) — never write them from model memory (full table in `extraction-rules.md §3`).

---

## Instructions

### Step 0 — Pre-flight (gate; do not crawl until all pass)

1. **Read the config.** Load `.ds-kb-config.json` from the project root (fall back to `.ds-kb-config.json.example` only to show the user what's missing — never run against the example). Read: `figma_mcp`, `figma_file_url`, `figma_library_urls`, `output_path`, `include_screenshots`, `frontend_src_path`, `storybook_url`, `max_variant_rows` (int, default `250`), `exhaustive_variants` (bool, default `false`). Set `meta.maxVariantRows = exhaustive_variants ? null : max_variant_rows` — a `null` row cap means "capture every variant, never sample" and is what Step 3 checks. Persist both into `meta.json` so the row cap travels with the run (ds-write/ds-refresh read it to know whether a matrix is complete).
2. **Resolve the MCP profile → tools.** Take `figma_mcp` (`official` | `desktop` | `console` | custom URL) and open `references/mcp-tool-map.md`. For every logical function the pipeline needs, resolve the actual tool name from the matching column. Note which capabilities are blank for this profile (one-shot, raw escape hatch, code mapping) and which degradation paths apply (capability matrix in the tool map).
3. **Confirm reachability BEFORE crawling.** Make one cheap call — the **Lightweight inventory** function on the file root (or **Search** for a known component). If it errors or returns nothing:
   > ⚠️ **Stop.** Report to the user: "The `<profile>` Figma MCP isn't reachable / returned nothing for `<file>`. Confirm the MCP is connected and the file URL in `.ds-kb-config.json` is correct, then re-run." Do not proceed.
4. **Check for a resumable cache.** If `output_path/.cache/inventory.json` already exists, load it — every inventory row whose `shard` is non-null (its `components/<slug>.json` was already written) becomes the skip-set for Step 8 (resume, don't restart). If absent, initialize `meta.json` with `meta` populated from config (`fileName`, `figmaFileUrl`, `generatedAt`, `extractorVersion: 1.1.0`, `mcp`, `cacheLayout: "sharded"`, `includeScreenshots`). (A legacy single-file `raw-extract.json` in `.cache/` is still honored on resume, but new runs always write sharded.)
5. **Branch-URL detection.** If `figma_file_url` contains `/branch/<branchKey>/`, the bridge treats the branch as its own file key. Record `meta.branchKey` and `meta.parentFileKey` separately, and warn the user: "This is a **branch** URL — the KB (and every future `ds-refresh`) is anchored to branch `<branchKey>`, not the parent file. Refresh against the same branch." Do not block; just record and warn.

Only when 1–4 pass, proceed.

---

### Step 1 — Inventory pass (build the work queue)

Call the **Lightweight inventory** function on the file → the full node map: every COMPONENT / COMPONENT_SET with **name, nodeId, stable key, setId, type, page, size**. Write it to `.cache/inventory.json` (`$defs/inventoryFile`), one lightweight row per component (no variant matrices). Add an `approxVariantCount` per set where cheaply available — Step 3 uses it to route batching.

- This list is the authoritative **work queue** and the **truncation check** for Step 2. Each row's `shard` starts null and is set when its `components/<slug>.json` is written (Step 8 resume anchor).
- If the semantic inventory tool under-reports (e.g. components on un-loaded pages) and the profile has the raw escape hatch, supplement with `extraction-rules.md` **Recipe A**. On large files (≳50 pages) a single root-wide `findAllWithCriteria` / `loadAllPagesAsync` **times out at the ~30s bridge command cap** — use the **paged, per-page traversal** (`loadAllPagesAsync` once, then iterate `figma.root.children` in chunks of ~15 pages calling `page.findAllWithCriteria`).
- **Do not trust `figma_get_design_system_summary` token counts** as the token inventory — it under-reports (has reported 0 tokens against 1,439 real). Token presence is confirmed in Step 4 via the variables tool, never the summary.
- Record each component's `key` immediately. Empty key → flag.

**Step 1b — Icon-set detection (collapse, don't shard).** Before queuing standalone COMPONENTs for deep extraction, detect a large flat glyph set. A COMPONENT is an **icon glyph** iff **all** of the following hold — apply every clause; do not collapse on name alone:

1. **No `componentPropertyDefinitions`** (no variant axes, no TEXT/BOOLEAN/INSTANCE_SWAP/SLOT props).
2. **Zero descendant INSTANCEs** (it composes nothing — a wrapper that swaps a glyph is *not* itself a glyph).
3. **Vector-only subtree** — leaves are only `VECTOR` / `BOOLEAN_OPERATION` / `ELLIPSE` / `RECTANGLE` / `STAR` / `LINE`; **any `TEXT` or `INSTANCE` descendant disqualifies it.**
4. **One of a large flat set** — >~50 sibling COMPONENTs on a single page, **especially** a page whose name matches `/icon|glyph|iconograph/i`. A page-name match plus clauses 1–3 is sufficient even below the count threshold; below ~50 siblings with no icon-named page, treat as an ordinary standalone COMPONENT (shard it) rather than collapsing.

Do **not** give each its own `components/<slug>.json` — that would bloat the cache, `index.json`, and every consuming agent's first load. Instead write `.cache/icons-manifest.json` (`$defs/iconsManifestFile`) with one row per glyph (`name`, `key`, `nodeId`, `size`), set `report.iconsCollapsed`, and **record the icon `key` set** (`iconsManifest.iconKeys`) — Step 4 (per-variant token resolution) and Step 5 (composition exclusion) both consume it, and ds-write renders the manifest as a single `components/atoms/Icon/` entry. Record the standalone tally in `inventory.standaloneSummary`.

**Step 1c — Composition pre-scan (cheap; populate the graph early).** Before any heavy deep extraction, run a **cheap composition pre-scan** that reads only **child-instance keys** per set — no variant matrices, no token bindings, no auto-layout — bounded per set (default variant plus any structurally-divergent variant only, capped at a few nodes per set). This populates `meta.json.compositionEdges` (`fromKey` → `toKey`, `via` = slot/layer name) **up front**, so the classification graph is known before the expensive Step 3 deep pass runs. Pre-scan recipe: `extraction-rules.md §5` (another agent is adding the bounded child-key-only recipe there; until it lands, use **Recipe D** restricted to child keys and skipping metric aggregation).

- Apply the **icon-key exclusion** here too (icon instances go into the edges but are marked so they don't raise the level — see Step 5); the pre-scan edges are the *observed-edge* graph, not composition rules.
- **Why early:** with the graph known up front, deep extraction (Step 3) and markdown writing (`ds-write`) may **overlap** — once a shard is written it is immediately eligible for ds-write's writer, instead of a hard two-phase barrier where all extraction must finish before any writing begins. The **shard remains the durable refresh anchor**; overlap is purely a latency optimization and changes no on-disk contract.
- **Skill separation stays intact.** The pre-scan is an **extract-side optimization only** — it seeds `compositionEdges` so writing can start sooner. It does **not** classify: `ds-write`'s classifier remains authoritative over atom/molecule/organism, reading the same `compositionEdges` / non-icon counts. ds-extract still captures metrics only (Step 5).

---

### Step 2 — Whole-system one-shot attempt (with paging fallback)

Run the **paging-fallback decision procedure** in `extraction-rules.md §2`. In short:

- If the **Whole-system one-shot** cell is blank for this profile (`official` / `desktop` / custom-without-it) → **skip this step**, log `one-shot: n/a`, go to Step 3.
- Else call it **once**. Then reconcile against the Step-1 inventory:
  - Transport "too large" / "truncated" / "MAX_TOKENS" error, OR returned component count `<` inventory count → **discard, fall back** to per-component (Step 3) for the missing ids. Record `meta.incomplete += ["one-shot-oversized→paged"]`.
  - Count matches inventory → accept the kit, but **split it into per-component `components/<slug>.json` shards** (never keep the whole kit in orchestrator context); still run Step 3 for any component whose variant matrix or token bindings came back empty/partial. On `console`/desktop prefer the batched Step-3 path over a whole-file kit for large systems — the kit hits the response cap first.

> ⚠️ Never trust the kit's own completeness — a kit that nears the cap drops its tail without erroring. The inventory count is the source of truth for *how many*.

---

### Step 3 — Deep per-component extraction (batched subagents, sharded writes)

This is the scaling core. Extraction runs in **subagents that write their own shards and return one line** — the heavy variant JSON stays in each subagent's context and goes straight to disk, so the orchestrator never holds it. Full procedure and the batched `figma_execute` recipe: `extraction-rules.md §6`.

**Batch the work queue** (skip any inventory row whose `shard` is already set — resume):

- **Small sets** (`approxVariantCount` ≤ ~30) → group ~10–12 per subagent. One `figma_execute` loops over the whole batch inside the plugin (not one call per component).
- **Large sets** (> ~150 variants: e.g. Button 680, Chip 540, IconButton 520, Paper 468) → **one subagent each**, so a single big matrix can't blow a batch.
- Keep **bridge concurrency ≈4** (4–6 subagents in flight). Subagents *can* reach the local Console bridge, but higher concurrency risks the ~30s command timeout under contention.

**Each extraction subagent** is told to:

1. Run **one** `figma_execute` that loops over its assigned component keys and returns compact JSON. If the inline return exceeds the MCP tool output cap, the Console MCP **auto-saves the full result to a file on disk** — read that file instead of re-fetching (`extraction-rules.md §6`). Never re-run the execute to work around size.
2. For each component, capture per the `$defs/component` schema:
   - **Variant property defs** — axis name → values (`axes`), verbatim.
   - **Variant matrix** — every variant's `nodeId` + **`key`** + verbatim `name` + `props` + `size` + `tokens[]` (below). **Sampling gate:** if the set's `totalVariantCount` > `meta.maxVariantRows` **and** `meta.maxVariantRows` is not `null` (i.e. `exhaustive_variants` is false), capture full axis option lists + the true `totalVariantCount` + a **bounded representative sample (≤ ~40 rows)** covering **axis boundaries and defaults** (first/last option of each axis, the default variant), and set the shard's `variantSampling: "sampled"`. Otherwise capture every row and set `variantSampling: "full"`. See `extraction-rules.md §6c`.
   - **Per-variant tokens** — each variant row carries `tokens[]` = `[{ role, token, key, type, literal }]` resolved from `boundVariables`. `token` is the **dotted** variable name (`color.action.primary.background`) or `null` when unbound. **Preferred source:** the deep component tool (`…for_development_deep`) returns `boundVariables` already resolved to token names + collection + `codeSyntax` (`extraction-rules.md §7.2`) — no id→name round-trip. **Fallback:** if the deep tool left a binding unresolved and the profile has the escape hatch, resolve with `extraction-rules.md` **Recipe C**. An **unbound** fill → `{ token: null, literal: '#RRGGBB' }` and increment `flags.unboundColors`. **Never invent a token name from a hex value.** On a *sampled* set, resolve tokens for the sampled rows only. Set the shard's component-level `uses_tokens` = the **deduped list of dotted token names** across all captured variants (ds-write puts it in the component `index.md` frontmatter). This is the pass that closes the earlier "Tokens: not captured this pass" gap — capture per-variant bindings here, not just the global token graph in Step 4.
   - **Non-variant props** — TEXT / BOOLEAN / INSTANCE_SWAP / SLOT, with **hash-suffixed keys preserved verbatim** (`Label#a1b2c3`).
   - **Auto-layout** — direction, padding (4), itemSpacing, primary/counter align, sizing notes.
   - **Applied styles**, **description** (verbatim or null), **docLinks**, and composition metrics (Step 5).
3. **Write one `.cache/components/<slug>.json` per component** (`<slug>` = PascalCased set name per `naming-conventions.md`) and **return only a one-line summary** to the orchestrator: `"<batch label>: N components → shards written, M flagged"`. Do **not** return the variant JSON.

The orchestrator updates each inventory row's `shard` from the returned summaries — never by holding shard contents. If a semantic tool returns axes/props incompletely and the profile has the escape hatch, the subagent recovers with `extraction-rules.md` **Recipe B**; otherwise it flags the gap in its shard and summary line.

---

### Step 4 — Tokens & styles

Call the **Tokens + styles** function once → collections, modes, resolved values per mode, configured `codeSyntax`, shared styles. Write them to `.cache/tokens.json` (`$defs/tokensFile`). This is often large — run it in its own subagent that writes `tokens.json` and returns a one-line count, so the token graph never sits in the orchestrator. Store both name forms (`name` dotted, `figmaName` slash-path). Resolve every `VARIABLE_ALIAS` so `ds-write` can split primitives vs. semantic.

- **Division of labor:** the *global* token collections/modes/values live here in `tokens.json`; the *per-variant* bindings (`variant.tokens[]`) are captured in **Step 3** from the deep tool's already-resolved `boundVariables`. This step does not re-walk every variant — it resolves the collection graph and fills any binding Step 3 flagged unresolved (Recipe C), so the two agree by `key`.
- Per-variant color/spacing bindings: resolve `boundVariables` to `{ role, token, key, type, literal }`. **Unbound** fill → `{ token: null, literal: '#RRGGBB' }` and increment `flags.unboundColors`.
- If the token tool omitted modes or didn't resolve an alias and the profile has the escape hatch, use `extraction-rules.md` **Recipe E** (local collections) / **Recipe C** (per-node `boundVariables`). On `official`/`desktop`, an unresolved binding is flagged, not back-solved.
- Include `figma_library_urls` collections if configured.

---

### Step 5 — Composition inference (no extra Figma calls)

From the descendant trees already pulled in Step 3, derive composition **metrics** per component (and per variant where structure differs): `instanceCount`, `distinctChildComponents`, `maxInstanceDepth`, `childComponentKeys`, `unresolvedMains`. Build the flat, deduped `compositionEdges` graph (`fromKey` → `toKey`, with `via` = slot/layer name).

- **Walk stops at each instance boundary** — do not recurse into a child instance's internal tree (its internals belong to *its* definition). Use `extraction-rules.md` **Recipe D** if the escape hatch is needed to read main keys.
- **Exclude icons from the counts that drive classification.** An INSTANCE counts as an **icon** iff **either**: (a) its main/set `key` ∈ the icon-manifest key set from Step 1b (`iconsManifest.iconKeys`), **or** (b) its main/set **name** matches `/(^|[^a-z])icon($|[^a-z])|glyph|vector/i` (case-insensitive; the word-boundary guard keeps `IconButton` from matching on `icon` alone only when it is a *wrapper* — a bare `Icon`/`ResizableIcon`/`Glyph`/`Vector` main matches, a composite whose name merely contains `icon` as a substring does not, e.g. `iconography-panel` is caught but `NotificationBell` is not). Prefer the **key** test (a); fall back to the **name** test (b) only when the main key is unresolved or the glyph set wasn't collapsed. Using this, compute `nonIconInstanceCount` / `distinctNonIconChildComponents` (instanceCount minus wrapped glyphs). Without this, a `Rating` (5 stars), `List`/`TransferList` (12 icons), or `Sidenav` (15 icons) is wrongly promoted to molecule/organism. Keep the raw `instanceCount` too, but classification uses the non-icon counts.
- **Icon instances are still recorded but do not raise the level.** An icon instance is **still** added to `compositionEdges` and the component's `contains` (it is real observed composition) — it is only excluded from the `nonIcon*` counts `ds-write` classifies on. **Edge cases to handle:** an icon nested two levels deep inside a wrapper (`Control → ResizableIcon → Vector`) is still just an icon (the `<CloseButton>` miss); an instance with an **unresolved main** (`getMainComponentAsync()` null) cannot be key-matched, so fall back to the name test on whatever name is available and, if still ambiguous, count it as **non-icon** (conservative — do not silently drop it) and let `unresolvedMains` flag the uncertainty.
- Each instance with a null main → increment `unresolvedMains` and add to `report.unresolvedInstanceMains`. Never guess the missing main.
- The extractor captures metrics only — **`ds-write` does the atom/molecule/organism classification.**

---

### Step 6 — Code mapping

Call the **Code mapping** function per component → `codeComponentName`, `codePath`, `props`, `confidence`. Set `has_code_mapping` accordingly.

- Resolve `codePath` relative to config `frontend_src_path` where the tool returns a repo-relative path.
- Low-confidence or multiple matches → `confidence: low/medium` (it caps the component's overall confidence in `ds-write` — see `confidence-levels.md`).
- If the **Code mapping** cell is blank for this profile, or the tool returns nothing → `codeMapping: null` and add the component to `report.missingCodeMapping`.

---

### Step 7 — Screenshots (optional)

Only if `include_screenshots: true` in config. For each variant, call the **Visual reference** function and save the PNG to `output_path/components/<level>/<Name>/<variant-slug>.png` (slug per `naming-conventions.md`). Record `variantSlug → relative png path` in `component.screenshots`. These are for human review; consuming agents never load them. Skip silently (note in report) if the profile lacks the **Visual reference** capability.

---

### Step 8 — Incremental, resumable, sharded write

The sharded layout **is** the incremental write: each extraction subagent persists its `components/<slug>.json` shards as it finishes (Step 3), and the orchestrator sets that row's `shard` in `inventory.json`. `tokens.json`, `icons-manifest.json`, and `meta.json` are written by their respective passes. An interrupted run resumes from whatever shards exist — nothing is dumped at the end.

**Skip-cache rule (resume):** a component is skipped iff its inventory row's `shard` is set AND (on a re-run against live Figma) its **`key` is unchanged AND its non-icon child-count (`composition.nonIconInstanceCount`) is unchanged**. Any difference → delete the stale shard and re-extract. This makes a re-run after a partial crawl cheap and the whole skill idempotent.

Keep `meta.passesCompleted` and `meta.incomplete` current in `meta.json` as passes finish.

---

### Step 9 — Extraction report (always print)

After the cache is written, print a report so the user knows exactly what `ds-write` will flag or down-rank. Source the numbers from `report.*` in the cache:

- **Counts** — `componentCount`, `variantCount`, token-collection count, composition-edge count.
- **Missing descriptions** — components with `flags.missingDescription` (→ manual/low-confidence intent in `ds-write`).
- **Unmapped variants** — variants with no resolvable property mapping.
- **Unbound colors** — `unboundColorVariants` (literal-only, `token: null`).
- **Low-confidence classifications** — components whose composition metrics are ambiguous (inconsistent child sets across variants, boundary straddle, category-not-atom) — these will land at `medium`/`needs_human_review` in `ds-write`.
- **Missing token refs** — components using raw values with no bound variables.
- **Sampled variant sets** — sets whose shard is `variantSampling: "sampled"` (captured `≤ ~40` of `totalVariantCount` rows because it exceeded `meta.maxVariantRows`). ds-write/ds-refresh surface these as **partial**, never as the complete matrix. Note the row cap in effect (or "exhaustive" if `meta.maxVariantRows` is null).
- **Missing code mappings** — `report.missingCodeMapping`.
- **Unresolved instance mains** — `report.unresolvedInstanceMains` (detached/missing → composition counts untrustworthy).
- **Empty keys** — any component/variant/token whose `key` came back empty (refresh will not be able to anchor it).
- **Incomplete passes** — `meta.incomplete` (e.g. one-shot paged, escape hatch unavailable for a needed field).

---

### Step 10 — Hand off to `ds-write`

Confirm each cache file validates against its `$def` in `shared/schemas/raw-extract.schema.json` (`meta.json`→`metaFile`, `inventory.json`→`inventoryFile`, `tokens.json`→`tokensFile`, each `components/<slug>.json`→`component`), then tell the user:

> ✅ Extraction complete. Sharded cache written to `<output_path>/.cache/` (`<n>` component shards, `<v>` variants, `<t>` token collections`<, X icons collapsed to icons-manifest.json>`). `<flagged count>` items flagged for review.
> **Next:** run **`ds-write`** to generate the markdown KB. It reads only the cache — no further Figma access needed.

Do **not** start writing markdown yourself — that is `ds-write`'s job. Stop here.

---

## Error Recovery

| Symptom | Action |
|---|---|
| Pre-flight reachability call errors | Stop at Step 0.3; do not crawl. Report MCP/file-URL issue to user. |
| One-shot returns "too large" / truncated | Paging fallback (Step 2 / `extraction-rules.md §2`). Never accept a truncated kit. |
| A semantic tool drops a field (axes, props, bound var) | If profile has the escape hatch → recover via the matching `figma_execute` recipe. Else → flag the field, never invent it. |
| `getMainComponentAsync()` returns null | Increment `unresolvedMains`; add to report. Do not guess the main. |
| Component `key` empty | Flag in report; refresh cannot anchor it. |
| Run interrupted mid-crawl | Re-run; Step 0.4 loads the cache and Step 8's skip-rule resumes from where it stopped. |
| Profile lacks code mapping / screenshots | Degrade gracefully (capability matrix in `mcp-tool-map.md`); note in report. |

---

## Quick Reference

| Step | Logical function (resolve via `mcp-tool-map.md`) | Writes |
|---|---|---|
| 0 Pre-flight | Lightweight inventory (reachability ping) | initializes `.cache/meta.json` (+ branch keys) |
| 1 Inventory | Lightweight inventory (+ Recipe A / paged traversal) | `.cache/inventory.json` (work queue, keys) |
| 1b Icons | _(from inventory)_ | `.cache/icons-manifest.json` (collapsed glyph set + `iconKeys`) |
| 1c Composition pre-scan | Child-instance keys only, bounded (+ Recipe D, keys only) | `meta.json.compositionEdges` seeded early (enables Step 3 / ds-write overlap) |
| 2 One-shot | Whole-system one-shot (paging fallback) | bulk shards or skip |
| 3 Per-component | Component structure + variants + **per-variant `tokens[]`** + sampling, **batched subagents** (+ Recipe B/C) | `.cache/components/<slug>.json` (one per set; `variantSampling`, `uses_tokens`) |
| 4 Tokens | Tokens + styles (+ Recipe C/E) | `.cache/tokens.json` (global graph; reconciles Step-3 bindings by key) |
| 5 Composition | _(no calls; + Recipe D if needed)_ | `composition` (non-icon counts) in each shard; edges in `meta.json` |
| 6 Code mapping | Code mapping | `codeMapping` in each shard |
| 7 Screenshots | Visual reference _(if `include_screenshots`)_ | `screenshots` |
| 8 Write | — | sharded `.cache/` (incremental, per shard) |
| 9 Report | — | console report from `report.*` |
| 10 Handoff | — | → `ds-write` |
