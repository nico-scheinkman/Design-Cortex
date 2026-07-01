---
name: ds-validate
description: "Validate a generated design-system KB for internal consistency, reference integrity, freshness, and Obsidian graph health. Use when asked to \"validate my KB\", \"check my KB\", \"lint the KB\", \"is my KB consistent\", \"run KB checks\", or as a CI gate after ds-write / ds-refresh. Runs eight checks — folder/index parity, variant-file presence, token-reference resolution, composition-reference resolution, index.json↔folder sync, freshness vs threshold, body-link graph reachability, and _review/ backlog — and reports pass/fail per check with a grouped list of items needing attention. NEVER auto-fixes anything; it only reports. Does NOT extract from Figma and does NOT modify the KB — for updates use ds-refresh."
license: MIT
metadata:
  version: 1.0.0
  category: design-system
  tags: design-system, knowledge-base, validation, ci, lint, reference-integrity, ds-kb-generator
---

# DS Validate

## Overview

`ds-validate` is the read-only health check for a generated KB. It answers one question: **is this KB internally consistent, complete, fresh, and navigable — or are there dangling references and gaps an agent would trip over?**

It runs **eight checks** and reports **pass/fail per check**, with the exact offending items grouped under each. It can run standalone ("validate my KB") or as a **CI gate** after `ds-write` or `ds-refresh`.

**Hard rule: this skill NEVER auto-fixes.** It does not write, move, delete, or re-extract anything. It reads the KB on disk and reports. Fixing is the human's job (or a subsequent `ds-refresh` run). A validator that mutates state cannot be trusted as a gate.

**What this skill does:**
- Reads `kb-output/index.json` and the `components/`, `tokens/`, `patterns/`, `_review/` trees.
- Runs eight consistency / integrity / freshness / graph checks.
- Emits a grouped pass/fail report and an overall exit verdict (PASS / FAIL / WARN).

**What this skill does NOT do:**
- Touch Figma (no extraction — that's `ds-extract` / `ds-refresh`).
- Modify, fix, or regenerate any file.
- Classify components (that's `ds-write`).

---

## Which Skill Do You Need?

| You want to… | Use |
|--------------|-----|
| Confirm the KB is consistent / fresh / navigable | **ds-validate** (this skill) |
| Pull Figma changes into the KB | `ds-refresh` |
| Generate the KB | `ds-extract` → `ds-write` |

---

## Prerequisites

- `kb-output/index.json` exists (conforms to `shared/schemas/root-index.schema.json`). If it does not, report a single hard FAIL: "No KB found — run ds-extract + ds-write first," and stop.
- `.ds-kb-config.json` is readable (needed for `freshness_warning_after_days` and `output_path`).

Resolve `output_path` from config (default `./kb-output`). All paths below are relative to it.

---

## Severity model

Each check yields one of:

- **PASS** — no issues.
- **FAIL** — a broken reference or missing required artifact. In CI, any FAIL fails the gate.
- **WARN** — a soft signal (stale freshness, items in `_review/`). In CI, WARN does not fail the gate by default but is surfaced.

Overall verdict: **FAIL** if any check FAILs; else **WARN** if any WARNs; else **PASS**.

---

## The Eight Checks

Run all eight even if an early one fails — the report should be complete, not short-circuited. For each, list every offending item; never summarize as "several."

### Check 1 — Every component has a folder with `index.md`  (FAIL)

For every entry in `index.json` → `components[]`:

1. Resolve its `path` (e.g. `components/atoms/Button`).
2. Confirm the folder exists.
3. Confirm `<path>/index.md` exists and is non-empty.

**FAIL items:** index entry whose folder is missing; folder present but no `index.md`; `index.md` present but empty.

### Check 2 — Every listed variant group has a file in `variants/`  (FAIL)

For each component, read its `index.md` Variant Groups table (and/or the `variant_groups` array in `index.json`). For each listed group:

1. Slugify the group name to kebab-case per `shared/references/naming-conventions.md`.
2. Confirm `<path>/variants/<group-slug>.md` exists.

**FAIL items:** a variant group listed in the table/array with no corresponding `variants/*.md` file. Also flag the inverse as a **WARN**: a file in `variants/` that no listed group points to (orphaned variant file).

### Check 3 — Every `uses_tokens` reference resolves  (FAIL)

Build the set of all real token names: read every file under `tokens/` and collect each token from the `Token` column of every token table (dotted names). For each component's `index.md` frontmatter `uses_tokens[]`:

1. Confirm each entry exists in that set (match on the dotted name; tolerate the `figma_name` `/`-form as a fallback match).

**FAIL items:** a `uses_tokens` entry that resolves to no row in any token file (dangling token reference). Also check variant files' token tables: any token name referenced there must likewise resolve — report unresolved ones here too.

### Check 4 — Every `composed_in` and `contains` points to a real component  (FAIL)

Build the set of all real component names from `index.json` → `components[].name`. For each component's frontmatter:

1. Every `contains[]` entry must name a component in that set.
2. Every `composed_in[]` entry must name a component in that set.
3. **Bidirectional sanity (WARN):** if A `contains` B, then B's `composed_in` should include A. Report asymmetric edges as WARN, not FAIL (composition is auto-derived and one side may legitimately lag), but surface them.

**FAIL items:** a `contains` or `composed_in` value naming a component that does not exist in the KB (dangling composition edge).

### Check 5 — `index.json` in sync with folder contents  (FAIL)

Walk the `components/{atoms,molecules,organisms}/` and `_review/` trees. For each component folder found on disk:

1. It must have a matching `index.json` entry (by `path`).
2. Conversely, every `index.json` entry must have a folder on disk.
3. The entry's `category` must match the level directory the folder actually sits in (`atoms/` ⇒ `category: atoms`, `_review/` ⇒ `category: _review`).

**FAIL items:** orphaned folder (on disk, not in `index.json`); missing folder (in `index.json`, not on disk); category/location mismatch (e.g. `index.json` says `molecules` but the folder is under `atoms/`).

### Check 6 — Freshness vs threshold  (WARN)

Read `index.json` → `generated_at` and `freshness_warning_after_days` (default 7 from config). Compute age in days against today.

**WARN** if `age > freshness_warning_after_days`. Report the actual age, the threshold, and a recommendation to run `ds-refresh`. This is never a FAIL — a stale KB is valid, just old.

### Check 7 — Graph health: body-text link reachability  (WARN)

The KB must be navigable via **body-text markdown links**, not frontmatter alone (per the repo's Obsidian graph rule — frontmatter `sources:`/`uses_tokens:` fields are invisible to the graph). Verify every `.md` file is reachable through body links from a parent index:

1. Treat `patterns/index.md` (the patterns table of contents) and each component `index.md` as roots/parents.
2. Build a link graph from **inline `[text](path.md)` links in file bodies only** — ignore frontmatter.
3. Expected chains to confirm:
   - `patterns/index.md` → each pattern file (auto + manual).
   - each component `index.md` → each of its `variants/*.md` files (the index body must link its variant files, not just list group names in a table without links).
   - token files cross-linked from where they're referenced, where the schema calls for it.

**WARN items:** any `.md` file with **no inbound body-text link** from a parent (an "orphan" in the Obsidian graph), and any body link that points to a **nonexistent file** (broken link — promote a broken link to FAIL since it's a dangling reference, not just isolation).

### Check 8 — `_review/` backlog  (WARN)

List every component folder under `_review/` (and every `index.json` entry with `category: _review` or `confidence: needs_human_review`).

**WARN items:** each component awaiting human classification. For each, give its name, why it landed there if recorded (e.g. boundary straddle, category-not-atom, unresolved instance mains — see `shared/references/confidence-levels.md`), and the next action ("classify and move out of `_review/`, then update `index.json`"). This is informational — `_review/` items are expected, not errors.

---

## Output Format

Emit a grouped pass/fail report. Run order is the eight checks; end with the overall verdict and a consolidated action list.

```
## DS Validate — [file name from index.json]  ([today])
KB: [output_path] · generated_at: [...] · [N] components, [N] tokens, [N] patterns

[PASS] Check 1 — Component folders & index.md          ([N]/[N] components)
[FAIL] Check 2 — Variant-group files                   ([N] missing)
   - Button: group "Size" listed, no variants/size.md
   - WARN orphan: Card/variants/legacy.md (no group points to it)
[FAIL] Check 3 — uses_tokens resolution                ([N] dangling)
   - Badge.index.md: color.feedback.legacy.bg → not found in any token file
[PASS] Check 4 — composition references                (no dangling edges)
   - WARN asymmetric: Card contains Button, but Button.composed_in omits Card
[FAIL] Check 5 — index.json ↔ folders sync             ([N] mismatches)
   - orphan folder: components/atoms/OldChip (not in index.json)
   - location mismatch: Modal under organisms/, index.json says molecules
[WARN] Check 6 — Freshness                             (age 12d > threshold 7d → run ds-refresh)
[WARN] Check 7 — Graph health                          ([N] orphans, [N] broken links)
   - orphan: patterns/brand-voice.md (no inbound body link from patterns/index.md)
   - FAIL broken link: Button/index.md → variants/icon-position.md (file missing)
[WARN] Check 8 — _review/ backlog                      ([N] awaiting classification)
   - IconButton — category-not-atom (variants are distinct element types)

---
VERDICT: FAIL  (Checks 2, 3, 5 failed; Checks 6, 7, 8 warned)

### Items needing attention
FAIL — must fix before this KB is trustworthy:
  1. [check] [item] → [suggested action]
  ...
WARN — review when convenient:
  1. ...
```

Rules for the report:
- **List every offending item by name and path.** Never collapse to a count without the list.
- Each FAIL item gets a one-line **suggested action** (e.g. "add variants/size.md", "remove OldChip folder or add it to index.json", "fix the token name or add the token"). Suggest — never perform — the fix.
- If a check is clean, still print it as `[PASS]` with the count it inspected, so the human sees coverage.
- State the overall **VERDICT** prominently (PASS / WARN / FAIL) — this is the CI signal.

---

## CI Usage

When run as a gate (after `ds-write` or `ds-refresh`, or in a pipeline):

- **Exit FAIL** if any of Checks 1–5 fail or any broken body link is found in Check 7. These are integrity breaks an agent loading the KB would hit.
- **Exit WARN** (non-blocking by default) for freshness (Check 6), graph orphans (Check 7), and `_review/` backlog (Check 8).
- Keep the report machine-scannable: the `VERDICT:` line is the single source of truth for pass/fail; the grouped lists are for the human reading the log.

---

## Final Checklist

Before reporting done, verify:

- [ ] All eight checks ran (no short-circuit on first failure).
- [ ] Every offending item is listed by name + path, with a suggested action for FAILs.
- [ ] Nothing was written, moved, deleted, or re-extracted — validation is read-only.
- [ ] Freshness compared `generated_at` against `freshness_warning_after_days`.
- [ ] Graph check used body-text links only (frontmatter ignored).
- [ ] An overall `VERDICT:` (PASS / WARN / FAIL) is stated for CI.
