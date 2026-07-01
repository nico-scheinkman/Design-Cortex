# MD Schema — every KB file type

This is the authoritative shape for every markdown file `ds-write` produces. Each section gives the **full frontmatter list**, the **required body sections in order**, and a **concrete annotated example** (Button-style, mirroring the plan). Match these exactly — a consuming agent parses both the frontmatter and the section headings.

Conventions used below:
- `« … »` marks an annotation, never literal output.
- Verbatim strings (variant values, hash-suffixed keys, node ids, token names) are copied from the cache exactly — never normalized.
- All values shown are illustrative; real values come from the `kb-output/.cache/` shards (`components/<slug>.json`, `tokens.json`, `classification.json`).

---

## 1. Component `index.md` (Tier 1)

The single entry point for a component. The proven shape: per-node Figma node + key in the variants table, a variant-axis block, sub-components composed, and a "Where it's used" section.

### Frontmatter (full list)

| Field | Required | Source | Notes |
|---|---|---|---|
| `name` | yes | `component.name` (raw, verbatim) | The display name; folder is the slug of this. |
| `category` | yes | classification | `atoms` \| `molecules` \| `organisms` \| `_review`. |
| `figma_component_id` | yes | `component.nodeId` | Session node id (set id for a COMPONENT_SET). |
| `figma_component_set_id` | optional | `component.setId` | `null` for a standalone COMPONENT. |
| `figma_link` | yes | `meta.figmaFileUrl` + node | Deep link to the node. |
| `code_component_name` | optional | `codeMapping.codeComponentName` | `null` if no code mapping. |
| `code_path` | optional | `codeMapping.codePath` | `null` if no code mapping. |
| `storybook_link` | optional | config | `null` if not configured. |
| `uses_tokens` | yes | derived from variant `tokens[]` | Dotted token names, deduped. `[]` if none bound. |
| `uses_styles` | optional | `component.appliedStyles` | Shared style names. |
| `composed_in` | yes | composition graph (parents) | Component names. `[]` if top-level. |
| `contains` | yes | composition graph (children) | Component names. `[]` for an atom. |
| `similar_to` | optional | not extractable | Always `[]` from auto-extraction; human-filled. |
| `deprecated_by` | optional | `flags.namePrefix` | `null` unless a 🚫/Deprecated prefix flagged it. |
| `confidence` | yes | classification | `high` \| `medium` \| `low` \| `needs_human_review`. |
| `last_updated` | yes | `meta.generatedAt` (date) | ISO date. |

### Body sections (in order)

1. `# <Name>` + a one-line callout describing what it is.
2. `## Anatomy` — size, fill, typography, radius, key structural parts.
3. `## Variant Groups` — table: `Group | Type | Options | Variant file`. Then a per-variant table: `Variant | Figma node | Figma key | Size | Description`.
4. `## Total Variants` — the integer + the axis block.
5. `## When to Use` — intent. **If synthesized, mark it** (see frontmatter-rules.md).
6. `## When NOT to Use` — intent. Same synthesized-marking rule.
7. `## Composition Notes` — what it contains / where it's composed (from the graph). "Where it's used".
8. `## Auto-Layout` — direction, padding, gap, alignment, sizing (from `component.autoLayout`).
9. `## Accessibility` — only structurally-derivable facts; the rest points to the manual a11y pattern.

### Annotated example

```markdown
---
name: Button
category: atoms
figma_component_id: "6111:117197"
figma_component_set_id: "6111:117000"
figma_link: "https://figma.com/file/ABC/Design-System?node-id=6111-117000"
code_component_name: Button
code_path: src/components/Button/Button.tsx
storybook_link: "https://storybook.company.com/?path=/story/button"
uses_tokens:
  - color.action.primary.background
  - color.action.primary.label
  - spacing.button.paddingX
  - radius.md
uses_styles: []
composed_in:
  - Controller
  - Card
contains: []          # « atom — no child component instances »
similar_to: []        # « not extractable; human-filled »
deprecated_by: null   # « no 🚫 prefix on the source name »
confidence: high
last_updated: "2026-06-24"
---

# Button

> The primary interactive action element. Use for any user-triggered action.

## Anatomy

- **Size**: 32–48px tall depending on `Size`; width hugs label + padding
- **Fill**: bound to `color.action.primary.background`
- **Label**: Roboto Medium, bound to `color.action.primary.label`
- **Radius**: `radius.md` (8px), borderless
- **Layout**: horizontal, label centered, optional leading/trailing icon slots

## Variant Groups

| Group | Type | Options | Variant file |
|---|---|---|---|
| Hierarchy | VARIANT | Primary, Secondary, Ghost, Danger | [hierarchy.md](variants/hierarchy.md) |
| Size | VARIANT | SM, MD, LG | [size.md](variants/size.md) |
| State | VARIANT | Default, Hover, Disabled | [state.md](variants/state.md) |

| Variant | Figma node | Figma key | Size | Description |
|---|---|---|---|---|
| `Hierarchy=Primary, Size=MD, State=Default` *(default)* | `6111:117197` | `e6b4eb95…294ab4` | 96×40px | Primary CTA, medium |
| `Hierarchy=Secondary, Size=MD, State=Default` | `6111:117202` | `bc8f881f…16eb82` | 96×40px | Secondary action |
| `Hierarchy=Danger, Size=MD, State=Default` | `6111:117205` | `be156f16…e01df3` | 96×40px | Destructive action |

> ⚠️ Variant value strings are verbatim from Figma — copy exactly (including any deliberate missing spaces) when setting `componentProperties`.

## Total Variants

**36 variants** across 3 axes:

```
Hierarchy: Primary | Secondary | Ghost | Danger
Size:      SM | MD | LG
State:     Default | Hover | Disabled
```

## When to Use

Use for any discrete user action — submit, confirm, navigate, trigger. Primary for the
single most important action on a surface; Secondary for supporting actions.

> _Synthesized by ds-write from structure — no Figma description present. Verify against design intent._

## When NOT to Use

Do not use for navigation between pages (use a Link) or for binary on/off state (use Switch).

> _Synthesized — see note above._

## Composition Notes

- **Contains**: nothing (atom).
- **Composed in**: `Controller` (`Type=Label + Icon` action), `Card` (footer actions).

### Where it's used

- **Edit Panel** — primary/secondary actions in panel footers
- **Card** — footer action row

## Auto-Layout

- **Direction**: HORIZONTAL
- **Padding**: 16 / 8 / 16 / 8 (L/T/R/B)
- **Item spacing**: 8px (icon ↔ label gap)
- **Alignment**: primary CENTER, counter CENTER
- **Sizing**: hug contents (width), fixed height per `Size`

## Accessibility

- `State=Disabled` maps to `[aria-disabled="true"]` (derived from state axis).
- Keyboard role, focus order, and label-contrast rules are NOT derivable from Figma —
  see [patterns/accessibility-rules.md](../../../patterns/accessibility-rules.md).
```

---

## 2. Variant file (Tier 2)

One file per variant axis. Captures per-option usage and resolved token values.

### Frontmatter

| Field | Required | Source |
|---|---|---|
| `component` | yes | parent `component.name` |
| `variant_group` | yes | axis name (e.g. `Hierarchy`) |
| `figma_property_name` | yes | raw property name |
| `figma_property_type` | yes | `VARIANT` \| `BOOLEAN` \| `TEXT` \| `INSTANCE_SWAP` \| `SLOT` |
| `options` | yes | list of verbatim option values |

### Body

One `### <Option>` block per option, each with: **Usage**, **Background token**, **Label token** (each WITH resolved value), **States**, **`Code prop:`**.

### Annotated example

```markdown
---
component: Button
variant_group: Hierarchy
figma_property_name: Hierarchy
figma_property_type: VARIANT
options:
  - Primary
  - Secondary
  - Ghost
  - Danger
---

# Button — Hierarchy

Maps to [../index.md](../index.md). Sets the visual weight / semantic role of the button.

### Primary

- **Usage**: the single most important action on a surface.
- **Background**: `color.action.primary.background` → `#0057FF`
- **Label**: `color.action.primary.label` → `#FFFFFF`
- **States**: Default, Hover (`#0046CC`), Disabled (`#A8C4FF`)
- **Code prop**: `hierarchy="primary"`

### Danger

- **Usage**: destructive/irreversible actions (delete, remove).
- **Background**: `color.feedback.danger.background` → `#E5484D`
- **Label**: `color.feedback.danger.label` → `#FFFFFF`
- **States**: Default, Hover (`#CE3539`), Disabled (`#F3B7B9`)
- **Code prop**: `hierarchy="danger"`

### Ghost

- **Usage**: low-emphasis inline action.
- **Background**: none — `token: null`, literal `transparent`   # « unbound; not invented »
- **Label**: `color.action.primary.label` → `#0057FF`
- **States**: Default, Hover (`color.surface.hover` → `#F2F4F7`)
- **Code prop**: `hierarchy="ghost"`
```

> For a `BOOLEAN` property the options are `True`/`False` and each block describes what the
> flag toggles. For `INSTANCE_SWAP`/`SLOT`, describe what may be placed and the default.

---

## 3. Token file

One per token group. Lives under the category folder (or as a single file for spacing/elevation/radius/motion).

### Frontmatter

| Field | Required | Source |
|---|---|---|
| `category` | yes | `color` \| `typography` \| `spacing` \| `elevation` \| `radius` \| `motion` |
| `group` | yes | sub-group (e.g. `semantic`, `scale`) — omit `group` for single-file categories or set to the category name |
| `token_count` | yes | number of rows |

### Body

A single table, columns **Token | Resolved Value | Code Syntax | Usage**, one row per variable.

### Annotated example

```markdown
---
category: color
group: semantic
token_count: 4
---

# Color — Semantic

Aliases that resolve to primitives. Bind these in components, never the primitives directly.

| Token | Resolved Value | Code Syntax | Usage |
|---|---|---|---|
| `color.action.primary.background` | `#0057FF` | `--color-action-primary-bg` | Primary button / CTA fill |
| `color.action.primary.label` | `#FFFFFF` | `--color-action-primary-label` | Text/icon on primary action |
| `color.feedback.danger.background` | `#E5484D` | `--color-feedback-danger-bg` | Destructive action fill |
| `color.surface.hover` | `#F2F4F7` | `--color-surface-hover` | Hover background for low-emphasis surfaces |

> Resolved Value is the literal after resolving any `VARIABLE_ALIAS` chain. If a value is an
> unresolved alias, the alias name appears here and is flagged in the write report.
```

---

## 4. Pattern files

Two flavors — `auto_extracted` (observed structure only) and `manual` (intent the team owns). See `pattern.schema.json` and `../../../shared/references/pattern-template.md`.

### Auto-extracted example

```markdown
---
type: pattern
name: composition-rules
source: auto_extracted
last_updated: "2026-06-24"
---

# Composition Rules

> Auto-extracted from observed Figma structure. `ds-refresh` regenerates this file.
> Only observed edges appear here — no intent is inferred.

## Observed composition

- `Button` is composed inside `Controller`, `Card`.
- `Input` is composed inside `Controller`, `SearchField`.
- `Card` contains `Button` (footer), `Avatar`, `Badge`.

## Recurring layout (from layout-rules.md)

- Edit Panel rows stack vertically, 0px gap, 268px wide — see [layout-rules.md](layout-rules.md).
```

### Manual scaffold example

Scaffolded verbatim from `../../../shared/references/pattern-template.md`:

```markdown
---
type: pattern
name: intent
source: manual
last_updated: "2026-06-24"
---

# Intent Rules

> These rules cannot be inferred from Figma structure. They are maintained by the design system team.
> `ds-refresh` never overwrites files marked `source: manual`.

## Destructive actions

- Always require a confirmation step; use the Danger Button variant.

## Empty states

- Every empty state includes a primary CTA; use the EmptyState organism.
```

---

## 5. `patterns/index.md`

```markdown
---
type: pattern
name: index
source: auto_extracted
last_updated: "2026-06-24"
---

# Patterns

| Pattern | Source | File |
|---|---|---|
| Composition rules | auto_extracted | [composition-rules.md](composition-rules.md) |
| Layout rules | auto_extracted | [layout-rules.md](layout-rules.md) |
| Accessibility rules | auto_extracted + manual | [accessibility-rules.md](accessibility-rules.md) |
| Intent | manual | [intent.md](intent.md) |
| Brand voice | manual | [brand-voice.md](brand-voice.md) |
```

---

## Graph-health rule (applies to all files)

Every file must be reachable by a **body-text** markdown link from its parent — frontmatter `sources:`/`options:` fields do not create graph edges. The chain is:

```
index.json / patterns/index.md          (entry points)
components/<level>/<Name>/index.md  →  variants/<group>.md  +  <variant>.png
patterns/index.md                   →  each pattern file
```

When you add any file, add the body link from its parent in the same pass.
