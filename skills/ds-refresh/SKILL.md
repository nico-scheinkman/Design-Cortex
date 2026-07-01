---
name: ds-refresh
description: "Re-extract a Figma design system and reconcile it into an existing KB without destroying human edits. Use when asked to \"refresh my KB\", \"sync from Figma\", \"update from Figma\", \"re-run extraction\", \"pull the latest design system\", or \"diff my KB against Figma\". Re-runs ds-extract, diffs the new extract against the KB by stable component key (never node id), updates changed components / tokens / auto-extracted patterns, flags removed components for human confirmation, and NEVER overwrites any file or field marked source: manual. Produces a diff report. Does NOT do first-time generation — use ds-extract + ds-write for that. Does NOT validate references — use ds-validate."
license: MIT
metadata:
  version: 1.0.0
  category: design-system
  tags: design-system, figma, knowledge-base, refresh, diff, mcp, ds-kb-generator
---

# DS Refresh

## Overview

`ds-refresh` keeps an existing KB in sync with a Figma design system that has moved on — new components, renamed variants, retuned tokens, recomposed structures. It re-extracts, **diffs by stable key**, and surgically updates only what changed, while treating every human edit as sacred.

**The one rule that governs everything below:** Figma is the source of truth for *structure* (variants, tokens, auto-layout, composition, code mapping). The human is the source of truth for *intent* (when-to-use prose, accessibility rules, brand notes, `similar_to`, manual pattern files). Refresh reconciles the two — it never lets a re-extraction stomp human prose.

**What this skill does:**
- Re-runs `ds-extract` to produce a fresh **sharded cache** under `.cache/` (`meta.json`, `inventory.json`, `tokens.json`, `components/<slug>.json`, optional `icons-manifest.json`).
- Diffs the new extract against the current KB **by component `key`** (the stable published anchor — never the session-specific `nodeId`).
- Updates changed components, tokens, and AUTO-extracted patterns (`source: auto_extracted`).
- Flags removed components with `deprecated_by` for human confirmation (never deletes).
- Handles new and reclassified components via `ds-write` logic.
- Preserves every `source: manual` file and every hand-edited intent field.
- Writes a structured diff report.

**What this skill does NOT do:**
- First-time KB generation (→ `ds-extract` then `ds-write`).
- Completeness / reference / freshness validation (→ `ds-validate`).
- Any write to Figma — this is read-only against Figma, write-only against the KB.
- Auto-deletion of anything. Removals are flagged, never executed.

---

## Which Skill Do You Need?

| You want to… | Use |
|--------------|-----|
| Generate a KB for the first time | `ds-extract` → `ds-write` |
| Pull the latest Figma changes into an existing KB | **ds-refresh** (this skill) |
| Check the KB is internally consistent / fresh | `ds-validate` |
| Re-crawl Figma into the raw cache only | `ds-extract` |

---

## Prerequisites

Before starting, confirm all of the following. Stop and ask if any is missing:

1. **An existing KB.** `kb-output/index.json` must already exist. If it does not, this is a first-time build → route to `ds-extract` + `ds-write`. Refresh has nothing to diff against otherwise.
2. **Figma MCP connected.** The MCP named in `.ds-kb-config.json` → `figma_mcp` must be reachable. Refresh re-extracts live.
3. **Config present.** `.ds-kb-config.json` with `figma_file_url` and `output_path`.

---

## How to Detect Manual Content (read this before Step 1)

`ds-refresh` must never overwrite human edits. There are **two kinds** of manual content, detected differently:

### 1. Manual files — frontmatter `source: manual`

Any file (most commonly a pattern file under `patterns/`, e.g. an intent / brand / accessibility-rules file scaffolded from `pattern-template.md`) whose frontmatter contains:

```yaml
source: manual
```

→ **Treat the entire file as untouchable.** Never rewrite it, never reorder it, never re-scaffold it. The only allowed touch is appending to the diff report a note that the file exists. Contrast with `source: auto_extracted` files, which refresh owns and may rewrite freely.

### 2. Hand-edited intent fields inside an otherwise-auto file

Component `index.md` files are auto-owned overall, BUT they carry intent sections and frontmatter fields the model is forbidden to author from Figma data. These are the human's:

- **Body sections:** `When to Use`, `When NOT to Use`, `Accessibility` (beyond mechanically-derivable role/keyboard), `Composition Notes` prose.
- **Frontmatter fields:** `similar_to`, `deprecated_by`, and any `confidence` the human manually upgraded from `needs_human_review`.

**How to tell a section was hand-edited:** an auto-scaffolded intent section is left as a placeholder by `ds-write` — exact placeholder strings are:

- `> ⚠️ Intent not extractable from Figma — author this section.`
- `_(synthesized — verify)_`

If the section still contains *only* the placeholder, it is untouched scaffold → refresh may replace it. If the placeholder is gone or prose has been added around it, **a human authored it → preserve it verbatim.**

> ⚠️ **Merge-conflict case (the hard one):** A component's AUTO fields changed in Figma (e.g. a new variant, a retuned token) AND a human also hand-edited that same component's intent sections. Do **not** regenerate the whole file. Surgically update **only** the auto-owned regions (frontmatter auto fields, Anatomy, Variant Groups table, Total Variants, Auto-Layout) and leave every intent section's prose byte-for-byte unchanged. Log this component under **"Merged (auto fields updated, manual prose preserved)"** in the diff report so the human can eyeball it.

---

## Auto-owned vs. Human-owned (the field-level contract)

| Field / section in a component `index.md` | Owner | Refresh behavior |
|---|---|---|
| `name`, `category`, `figma_component_id`, `figma_component_set_id`, `figma_link` | auto | Overwrite from extract (id re-resolved from key) |
| `figma_component_key` | auto (stable) | The diff anchor — never changes for a given component |
| `uses_tokens`, `uses_styles`, `contains`, `composed_in` | auto | Overwrite from extract |
| `code_component_name`, `code_path`, `storybook_link`, `has_code_mapping` | auto | Overwrite from extract |
| `last_updated` | auto | Set to today on any change |
| Anatomy, Variant Groups table, Total Variants, Auto-Layout | auto | Overwrite from extract |
| `similar_to`, `deprecated_by` | human | **Preserve.** Refresh only *adds* a `deprecated_by` flag when a component is removed (see Step 4) |
| `confidence` | mixed | Preserve a human upgrade; otherwise recompute via `ds-write` rules |
| When to Use / When NOT to Use / Accessibility prose / Composition Notes prose | human | **Preserve** unless still raw placeholder |
| Any file with `source: manual` | human | **Preserve entirely** |
| Auto pattern files (`source: auto_extracted`) | auto | Overwrite from extract |

---

## Protocol

### Step 1 — Re-extract

Re-run **`ds-extract`** against the configured Figma file. This produces a fresh **sharded** `kb-output/.cache/` (files conform to the `$defs` in `shared/schemas/raw-extract.schema.json`), plus the extraction report.

- Do not hand-roll extraction here. Invoke the `ds-extract` skill so the same MCP tool-map, paging fallback, and not-extractable flagging discipline apply.
- After it completes, confirm `.cache/meta.json` exists and its `meta.figmaFileUrl` matches `.ds-kb-config.json` → `figma_file_url`. **If `meta.branchKey` is set, the extract is branch-scoped — confirm you re-extracted the same branch** the KB was built from, not the parent file. If they differ, **stop** — you are about to diff against the wrong file/branch.
- Note `meta.incomplete[]`. Any component listed there was only partially extracted (e.g. paging fallback cut off). Diffing a partial component risks a false "changed" or false "removed". Exclude `meta.incomplete[]` components from the removal check (Step 4) and flag them in the report under **"Skipped (incomplete extraction)"**.

### Step 2 — Diff by key (NOT node id)

Build two maps and diff them. **The join key is the stable component `key`, never `nodeId`.** Node ids are session-specific and change between extractions; keys are the published-component anchor that survives renames, moves, and re-extraction.

1. **Old map** — from the existing KB: read `kb-output/index.json`, key each entry by its `figma_component_key`. For variant- and token-level diffing, also read each component's `index.md` and `variants/*.md`.
2. **New map** — from the fresh extract: key each `components/<slug>.json` shard (join via `inventory.json`) by its `key`. Also fold in the `icons-manifest.json` glyph keys so a removed/added icon is diffed against the collapsed `Icon/` entry, not treated as a missing component.
3. **Re-resolve node ids from keys.** For every component matched by key, take the *new* `nodeId` from the extract and overwrite the stored `figma_component_id`. (A component whose only change is its node id is **not** a content change — it is a re-anchor; record it under "Re-anchored", do not bump `last_updated` for that alone.)

Classify each key into exactly one bucket:

| Bucket | Condition |
|---|---|
| **Unchanged** | key in both maps, no field differs |
| **Changed** | key in both maps, ≥1 auto field differs (variants, tokens, auto-layout, composition, code mapping, description) |
| **Reclassified** | key in both maps, atomic level differs (e.g. `atoms` → `molecules`) — see Step 6 |
| **New** | key only in new map — see Step 6 |
| **Removed** | key only in old map — see Step 4 |

For **Changed** components, diff at the field level so the report can say *what* changed: variant added/renamed/removed (match variants by their own `key`), token binding changed (`uses_tokens` delta + resolved-value delta), auto-layout delta, `contains`/`composed_in` delta, description delta, code-mapping delta.

### Step 3 — Update changed components, tokens, and auto patterns

For each **Changed** component, apply the **auto-owned vs. human-owned** contract above:

1. Overwrite every auto-owned frontmatter field and auto-owned body section from the extract.
2. **Leave every human-owned section untouched** unless it is still raw placeholder (per "How to Detect Manual Content"). If a component has both auto changes and human prose, this is the merge-conflict case — update auto regions only, preserve prose, log under "Merged".
3. Rewrite affected `variants/*.md` files from the new variant matrix (these are fully auto-owned: usage line, tokens-with-resolved-values, states, `Code prop:`). Add a file for a new variant group; for a removed variant group, see Step 4's flagging discipline (do not silently delete — flag it).
4. Set `last_updated` to today for any component whose auto content actually changed.

**Tokens:** re-match token variables by `key` (fall back to `figma_name`, the original `/`-path, when a variable has no key). For each changed token, update its row (`Resolved Value`, `Code Syntax`) in the relevant token file. New tokens get a new row; tokens that disappeared from Figma get their row flagged with a trailing `⚠️ removed in Figma — confirm` comment, **not** deleted. Token files are entirely auto-owned.

**Auto-extracted patterns** (`source: auto_extracted` — composition-rules, layout-rules, token-usage, typography, color-roles): regenerate these in full from the new extract via `ds-write` logic. They are derived artifacts; rewriting them is safe. **Never touch a `source: manual` pattern file** in this step.

### Step 4 — Flag removed components (never delete)

A key present in the old KB but absent from the new extract means the component was deleted, unpublished, or renamed-with-new-key in Figma. **Do not delete the folder.** Instead:

1. Set its frontmatter `deprecated_by` to a list:
   - `deprecated_by: ["<replacement name>"]` if a heuristic suggests a successor — e.g. a New component (Step 6) shares a base name, or the removed component's name carried a deprecation prefix (`🚫`, `Deprecated`, `Old`, `[deprecated]`) per `shared/references/naming-conventions.md`.
   - `deprecated_by: ["removed"]` if no successor is evident.
2. Append a body note: `> ⚠️ This component was not found in the latest Figma extract (by key). Flagged for human confirmation — confirm removal or restore.`
3. Leave it in `index.json` but list it in the report under **"Removed (flagged, awaiting human confirmation)."**

The same flag-don't-delete rule applies to a removed **variant group** within a surviving component, and to a removed **token** (Step 3): flag in place, never silently drop.

> ⚠️ Renames are the trap. A Figma rename that **keeps the key** is a Changed component (the name field updates, nothing is lost). A rename that **mints a new key** looks like Removed + New. When a Removed and a New component share a slugified base name or anatomy fingerprint, note the likely pairing in the report so the human can confirm rather than re-authoring intent prose from scratch.

### Step 5 — CRITICAL: never overwrite manual content

This is the gate every write in Steps 3, 4, and 6 must pass. Before writing any file:

1. **Read its current frontmatter.** If `source: manual` → abort the write for that file. Manual pattern files (intent, brand, hand-authored accessibility rules) are owned by the design team and are off-limits to refresh.
2. **For component `index.md` files**, never blanket-overwrite. Splice: replace only auto-owned regions; copy human-owned intent sections forward verbatim. Detect a hand-edited section by the absence of the raw placeholder strings (see "How to Detect Manual Content").
3. **Preserve manually-set frontmatter:** `similar_to`, an existing human-authored `deprecated_by`, and a `confidence` a human upgraded out of `needs_human_review`. Refresh may *add* a `deprecated_by` flag on removal (Step 4) but must not clobber an existing human value — append to the list instead.

When in doubt about whether prose is human-authored, **preserve it** and flag the component in the report for the human to reconcile. Losing a Figma update is recoverable on the next refresh; losing human prose is not.

### Step 6 — New and reclassified components

**New components** (key only in the new extract): hand them to **`ds-write`** classification logic. Classify atom/molecule/organism from the descendant tree (atom = no child instances; molecule = 2–4 atom instances; organism = molecules, or 5+ atoms, or self-managed layout). Ambiguous → `confidence: needs_human_review`, folder placed in `_review/`. Write the full `index.md` + `variants/*.md`, scaffolding intent sections with the standard placeholders (so a later hand-edit is detectable). Add the entry to `index.json`.

**Reclassified components** (key in both, atomic level changed — e.g. an atom that gained child instances and is now a molecule):

1. Move the folder to the new level directory (`atoms/` → `molecules/`) and update its `path` + `category` in `index.json`.
2. Carry the existing file forward — **do not regenerate it.** Apply the same splice rules as Step 3: update auto regions, preserve human intent prose. Reclassification must not cost the human their when-to-use notes.
3. If the new classification is ambiguous, move to `_review/` and set `confidence: needs_human_review`, but still preserve prose.
4. Log the move (old level → new level) in the report.

### Step 7 — Write the diff report

Emit a clear, grouped report. Suggested format:

```
## DS Refresh — Diff Report  ([file name], [today])
Re-anchored from extract generated at [meta.generatedAt]; MCP profile: [meta.mcp]

### New (N)
- [Name] — classified [level], confidence [level][, → _review/]

### Changed (N)
- [Name]
    - variants: +[added] / ~[renamed] / -[removed-FLAGGED]
    - tokens: [uses_tokens delta], resolved-value changes on [token names]
    - auto-layout: [field: old → new]
    - composition: contains [delta]; composed_in [delta]
    - code mapping: [old → new]

### Merged (auto fields updated, manual prose preserved) (N)
- [Name] — updated [auto regions]; preserved intent sections: [list]

### Reclassified (N)
- [Name] — [old level] → [new level][, → _review/]; prose preserved

### Removed (flagged, awaiting human confirmation) (N)
- [Name] — deprecated_by: [value]; likely successor: [name|none]

### Re-anchored (node id changed, no content change) (N)
- [Name] — [old id] → [new id]

### Tokens (N changed / N new / N flagged-removed)
- [collection.token]: [old → new]

### Auto patterns regenerated
- [pattern file names]

### Preserved (source: manual — untouched)
- [file paths]

### Skipped (incomplete extraction)
- [component names from meta.incomplete]

### Action items for the human
- Confirm removals: [...]
- Reconcile merge cases: [...]
- Classify _review/ items: [...]
```

End by stating the net counts and explicitly reminding the human which items need their confirmation. Do **not** auto-resolve removals or merge conflicts — surface them and stop.

---

## Final Checklist

Before reporting done, verify:

- [ ] `ds-extract` was re-run; `.cache/meta.json` + shards exist and match the configured `figma_file_url` (and branch, if `meta.branchKey` is set).
- [ ] Diff was performed **by key**, not node id; node ids re-resolved from keys.
- [ ] Every `source: manual` file is byte-for-byte unchanged.
- [ ] No component `index.md` was blanket-overwritten — auto regions spliced, human intent prose preserved.
- [ ] No component, variant group, or token was deleted — removals flagged via `deprecated_by` / inline comment.
- [ ] New components written via `ds-write` logic; ambiguous ones in `_review/`.
- [ ] Reclassified components moved + `index.json` `path`/`category` updated, prose preserved.
- [ ] `index.json` reflects all adds, reclassifications, and re-anchored ids.
- [ ] Diff report emitted with all buckets and a human action-items list.
- [ ] (Recommended) `ds-validate` run afterward to confirm the refreshed KB is internally consistent.
