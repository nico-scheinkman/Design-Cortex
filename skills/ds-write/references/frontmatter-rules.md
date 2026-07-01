# Frontmatter Rules

What belongs in frontmatter vs body, which fields are required, how `confidence` and `source` work, how unextractable fields are represented, and the graph-health requirement. Applies to every file `ds-write` writes. Field shapes are defined in `../../../shared/schemas/{component,token,pattern}.schema.json` and `root-index.schema.json`; this file is the editorial policy around them.

---

## The frontmatter / body split

**Frontmatter = machine-queryable metadata.** Anything an agent filters or resolves on — names, ids, keys, categories, token references, relationships, confidence, dates. Frontmatter is YAML, parsed without reading prose.

**Body = human- and agent-readable knowledge.** Anatomy, variant tables, intent prose, token tables, composition notes. Body is what an agent loads when it needs to *use* the component.

Rule of thumb: if `ds-validate` or a consuming agent needs to look it up programmatically (does this token resolve? does this `composed_in` point to a real component?), it goes in frontmatter. If it's explanatory, it goes in the body.

---

## Per-file fields

### Component `index.md`

| Field | Required | If unextractable |
|---|---|---|
| `name` | required | — (always present) |
| `category` | required | `_review` if classification failed |
| `figma_component_id` | required | — |
| `figma_component_set_id` | optional | `null` for standalone COMPONENT |
| `figma_link` | required | — |
| `code_component_name` | optional | `null` |
| `code_path` | optional | `null` |
| `storybook_link` | optional | `null` (not configured) |
| `uses_tokens` | required | `[]` (raw-hex-only component — flag in report) |
| `uses_styles` | optional | `[]` |
| `composed_in` | required | `[]` |
| `contains` | required | `[]` |
| `similar_to` | optional | `[]` (never auto-filled — no Figma primitive) |
| `deprecated_by` | optional | `null`, or `[name]` only if a name-prefix flag was detected |
| `confidence` | required | computed; see below |
| `last_updated` | required | `meta.generatedAt` date |

Body sections (all required, in the order given in `md-schema.md`): description, Anatomy, Variant Groups, Total Variants, When to Use, When NOT to Use, Composition Notes, Auto-Layout, Accessibility. Missing data in a body section is stated explicitly ("No Figma description present"), never silently dropped or invented.

### Variant file

Frontmatter: `component`, `variant_group`, `figma_property_name`, `figma_property_type`, `options` — all required. The per-option prose (usage, tokens-with-values, states, `Code prop:`) lives in the body.

### Token file

Frontmatter: `category`, `group`, `token_count` — all required. The token rows live in the body table. Resolved values and code syntax are body content, not frontmatter (they are per-row, not per-file).

### Pattern file

Frontmatter: `type` (always `pattern`), `name`, `source` (`auto_extracted` | `manual`), `last_updated` — all required. Everything else is body.

### `index.json`

Not markdown — pure JSON, conforming to `root-index.schema.json`. It is the only file with no body. Every component (including `_review/`) appears here.

---

## `confidence` — how it surfaces

`confidence` is computed once in classification (`atomic-classification-rules.md`) per the triggers in `../../../shared/references/confidence-levels.md`, and surfaced in **two** places that must agree:

1. The component `index.md` frontmatter `confidence:`.
2. The matching `components[].confidence` entry in `index.json`.

`ds-validate` cross-checks these. Values: `high`, `medium`, `low`, `needs_human_review`. A `needs_human_review` component is written under `_review/` and carries `category: _review`.

A consuming agent reads `confidence` to decide how much to trust the file:
- `high` → trust fully.
- `medium` → trust structure, verify intent fields.
- `low` → treat intent/usage as a starting point.
- `needs_human_review` → do not rely on the classification at all.

---

## `source: manual` vs `source: auto_extracted`

This applies to **pattern files** and is the contract that protects human work.

- `source: auto_extracted` — the file is fully derived from the cache. `ds-refresh` regenerates it on every refresh; any hand-edit will be overwritten. Do not put intent here.
- `source: manual` — the file is owned by the design team. `ds-write` only ever *scaffolds* it (from `pattern-template.md`) and **never overwrites an existing `source: manual` file**; `ds-refresh` likewise never touches it. This is why intent, brand voice, and non-derivable accessibility rules must carry `source: manual` — it is the flag that tells refresh "hands off."

Practical consequence for `ds-write`: before writing any pattern file, check whether a file with that name already exists with `source: manual` — if so, leave it. Only write/overwrite `auto_extracted` files.

---

## Representing unextractable fields (never invent)

Figma cannot express several things the schema asks for. Represent the gap explicitly:

| Field / section | Representation |
|---|---|
| `deprecated_by` | `null` unless a name prefix (`🚫`, `Deprecated`, `Old`, `[deprecated]`) was detected — then `[<name>]` flagged for human confirmation, not auto-applied. |
| `similar_to` | always `[]` from auto-extraction (human-filled later). |
| `code_*`, `storybook_link` | `null` when no Code Connect / config. |
| `uses_tokens` | `[]` when nothing is bound; unbound colors appear in the body as a literal value with `token: null`. |
| When to Use / When NOT to Use | if not read from a Figma description, write the synthesized text AND append the marker `> _Synthesized by ds-write — verify against design intent._`. Synthesized intent caps `confidence` at `medium` (or lower). |
| Accessibility | only structurally-derivable facts (e.g. a `State=Disabled` axis → `[aria-disabled]`). Everything else links out to the manual `patterns/accessibility-rules.md`. |
| Unresolved token alias | the alias name appears in the Resolved Value column and is flagged in the write report — never resolved to a guessed literal. |

The discipline: a missing fact is shown as missing. The KB never fills a gap from model memory.

---

## Graph health (all files)

Obsidian/markdown graph edges come from **body-text** links only — frontmatter list fields (`options:`, `uses_tokens:`, `composed_in:`) are invisible to the graph. Therefore:

- `components/<level>/<Name>/index.md` must contain body links to each `variants/<group>.md` and each per-variant `.png` it references.
- `patterns/index.md` must body-link every pattern file.
- The token-category and variant relationships that exist only in frontmatter are duplicated as body links where a human would navigate them (e.g. the Variant Groups table links each row's file).

Every file `ds-write` creates must be reachable from `index.json` / `patterns/index.md` through this body-link chain. Add the parent's body link in the same pass that creates the child.
