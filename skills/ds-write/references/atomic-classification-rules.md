# Atomic Classification Rules

How `ds-write` assigns each component an atomic level (`atoms` / `molecules` / `organisms`) and a `confidence`, and when it instead routes a component to `_review/` as `needs_human_review`. Everything here is computed from the cache — specifically each component's `composition` metrics and per-variant structure. No Figma access.

The `confidence` triggers below are summarized from `../../../shared/references/confidence-levels.md` — that file is the source of truth; this file applies it to classification.

---

## Inputs (from `raw-extract.schema.json`)

Per component, classification reads:

- `composition.instanceCount` — total child component instances (any depth).
- `composition.distinctChildComponents` — number of distinct child components.
- `composition.maxInstanceDepth` — deepest nesting of instances.
- `composition.childComponentKeys` — keys of direct/descendant child components (used to look up whether children are atoms or molecules).
- `composition.unresolvedMains` — nested instances whose main component could not be resolved.
- `variants[].composedOf[]` — per-variant child composition, used to detect structure that **varies across variants**.

The child levels needed for the molecule/organism test come from classifying the whole set and resolving `childComponentKeys` against it (atoms first, then molecules, then organisms — a single ordered pass works because atoms never depend on classification of others).

---

## Icon instances are primitives (count exclusion)

**Before applying the heuristic, exclude icon and icon-wrapper instances from the composition counts.** A control that merely wraps an icon (CloseButton, IconButton, a Button with a leading glyph) is structurally an atom even though the icon is technically a nested COMPONENT instance — often two levels deep (`Control → <ResizableIcon> → X glyph → Vector`). Counting those instances would wrongly promote a simple control to molecule/organism.

A child instance is an **icon primitive** when any of these hold:
- its main/set name matches an icon pattern (`Icon`, `*Icon`, `ResizableIcon`, `<Icon …>`, `Glyph`, `Vector`, single-letter glyph names like `X`); OR
- it is an `INSTANCE_SWAP` target typed as an icon (the swap property name contains `Icon`); OR
- its entire subtree is vector/boolean-op shapes with no text and no further component instances.

Compute **`distinctNonIconChildComponents`** and **`nonIconInstanceCount`** by removing icon primitives, and run the heuristic on those. Keep the raw `instanceCount`/`distinctChildComponents` only for the report. (If the extractor already emits `composition.distinctNonIconChildComponents`, use it; otherwise derive it here from `childComponentKeys` + the icon patterns above.) Record any wrapped icon in the component's `contains` list regardless — it's real composition, it just doesn't change the atomic level.

---

## The heuristic

Apply in order; the first match wins. **All counts below mean the icon-excluded counts** (`nonIconInstanceCount`, `distinctNonIconChildComponents`).

1. **atom** — `nonIconInstanceCount == 0`. No non-icon child component instances. (It may still wrap icons, and have raw layers, text, and variant axes — an atom is about *composition*, not simplicity.)

2. **molecule** — **2–4** non-icon atom instances as direct children, AND no child is itself a molecule or organism, AND it does not manage structural layout of its own (a single auto-layout row/column grouping the atoms is fine; sectioned multi-region layout is not).

3. **organism** — any of:
   - contains at least one **molecule** (or organism) instance; OR
   - **5 or more** atom instances; OR
   - **manages its own layout** — auto-layout with distinct structural regions (header/body/footer, multiple sections), i.e. it composes a layout rather than just lining up atoms.

A component with exactly **1** non-icon child atom instance is treated as a molecule by default (it composes one atom), but flag it if that feels like a thin wrapper — see straddle below. (A component whose only nested instances are icons has `nonIconInstanceCount == 0` and is an **atom** by rule 1 — see Example F.)

---

## `needs_human_review` triggers → `_review/`

If any trigger fires, set `confidence: needs_human_review`, place the folder under `_review/<Name>/`, and set `category: _review` in `index.json`. The component is still real and fully written — only its *level* is unassigned.

1. **Structure varies across variants** — different child-instance sets across `variants[].composedOf[]` (e.g. one variant has 2 atoms, another has 6). Classification would be unstable, so defer.
2. **Unresolved instance mains** — `composition.unresolvedMains > 0`. Detached/missing mains make `instanceCount`/`distinctChildComponents` untrustworthy, so the molecule/organism counts can't be trusted.
3. **Boundary straddle** — exactly **4** direct child atoms (the molecule/organism edge), OR the count says molecule (2–4) but `maxInstanceDepth` implies organism-level nesting (depth ≥ 3), OR count says organism (5+) but everything is one flat trivial row.
4. **Category-not-atom** — a single COMPONENT_SET whose variant axis really enumerates *distinct element types* (e.g. `Type=Heading | Button | Image | Divider`) rather than states/styles of one thing. Count may say atom (no instances), but semantically it is a category/collection. Signals: a single axis with many semantically-unrelated values, large size variance across variants, and per-variant `composedOf` that differs wildly. A "catch-all" set that bundles several unrelated primitives under one node is the classic case.

---

## Confidence for non-review components

When no `needs_human_review` trigger fires, set the level and then choose confidence (per `confidence-levels.md`):

- `high` — clean classification; structure consistent across variants; Figma description present; tokens bound.
- `medium` — one soft signal: some variants missing descriptions, one mildly inconsistent variant, synthesized intent, or an ambiguous/low-confidence code mapping (`codeMapping.confidence != high`).
- `low` — a known gap: intent fully synthesized AND no token bindings (`uses_tokens == []`), or multiple soft signals stacked.

Synthesized When-to-Use / When-NOT-to-Use sections always cap a component at `medium` or lower (and are marked in the body, per `frontmatter-rules.md`).

---

## Worked examples

### Example A — `Button` → atom, high

Cache: `instanceCount = 0`, `distinctChildComponents = 0`, `unresolvedMains = 0`, variants consistent (`Hierarchy × Size × State`), Figma description present, fills bound to `color.action.*`.

- Rule 1 matches (`instanceCount == 0`) → **atom**.
- No review trigger. Description present, tokens bound, structure consistent → **`confidence: high`**.
- Written to `components/atoms/Button/`.

### Example B — `SearchField` → molecule, high

Cache: `instanceCount = 2` (`Input` + `IconButton`), both children are atoms, `distinctChildComponents = 2`, `maxInstanceDepth = 1`, `unresolvedMains = 0`, structure identical across `State` variants.

- Rule 1 no (`instanceCount > 0`). Rule 2: 2 atom instances, no molecule child, simple single-row grouping → **molecule**.
- No review trigger; consistent structure → **`confidence: high`**.
- Written to `components/molecules/SearchField/`.

### Example C — `Card` → organism, high

Cache: contains `Avatar` (atom), `Badge` (atom), a `Button` ×2, and a `MediaBlock` (molecule); `instanceCount = 5`, manages header/body/footer auto-layout regions.

- Rule 3 matches twice (contains a molecule; 5+ atoms; manages layout) → **organism**.
- No review trigger → **`confidence: high`**.

### Example D — a catch-all `Atoms` set → `_review`, needs_human_review

Cache: a single COMPONENT_SET, axis `Type = Heading | Paragraph | Button | Image | Divider`, `instanceCount = 0` per variant but huge size variance and unrelated `composedOf` per variant.

- Rule 1 would say atom (`instanceCount == 0`)…
- …but trigger 4 (category-not-atom) fires: one axis enumerating distinct element types. → **`needs_human_review`**, written to `_review/Atoms/`, `category: _review` in `index.json`. The user splits it into real components and re-runs.

### Example E — `Toolbar` → `_review`, needs_human_review (straddle)

Cache: `instanceCount = 4` direct child atoms, all consistent.

- Rule 2 (2–4 atoms) would say molecule, but the count is **exactly 4** — trigger 3 (boundary straddle) fires. → **`needs_human_review`**, written to `_review/Toolbar/`. A human confirms whether it's a dense molecule or a small organism.

### Example F — EDS `<CloseButton>` → atom, medium (real, from end-to-end test)

Cache: `instanceCount = 1`, `maxInstanceDepth = 2`, the one nested instance is `<ResizableIcon>` (an icon wrapper around an `X` glyph → Vector), `unresolvedMains = 1`. 9 variants (`Color × State`), Figma description present, icon fill bound to `action.active`.

- Naïve depth/count rules would say **molecule** (1 child) or even **organism** (depth 2) — both **wrong**; it's an icon-button.
- The icon-exclusion step removes `<ResizableIcon>` → `nonIconInstanceCount = 0`, `distinctNonIconChildComponents = 0`. Rule 1 matches → **atom**. The icon is still recorded in `contains: [ResizableIcon]`.
- No review trigger fires, but two soft signals (synthesized When-to-Use/Accessibility; `unresolvedMains > 0`) cap it at **`confidence: medium`**.
- Written to `components/atoms/CloseButton/`. This is the exact case that motivated the icon-primitive rule above.
