# Extraction Rules

The detailed rules `ds-extract` follows. The SKILL.md protocol is the *order of operations*; this file is the *how* for the tricky parts: normalization, the paging-fallback decision, what is NOT reliably extractable, the composition metrics to capture, and the raw `figma_execute` recipes for fields the semantic tools miss.

Logical tool names below resolve through `mcp-tool-map.md`. Naming/slugging rules live in `../../../shared/references/naming-conventions.md` — this file defers to it and only adds extraction-specific notes.

---

## 1. Normalization (extraction-specific notes)

Full slugging and naming rules: **`shared/references/naming-conventions.md`**. Do not duplicate them. The extractor's job is to capture **raw, verbatim data** — `ds-write` does the slugging. Extra rules that matter at *extract* time:

- **Preserve variant value strings VERBATIM.** The `variant.name` (e.g. `Hierarchy=Primary, Size=MD, State=Default`) and every value inside `variant.props` must match Figma byte-for-byte. These strings are later fed back into `setProperties` / `componentProperties`; a single normalized space breaks the round-trip. This includes deliberate oddities like `Label +Full width Input` and emoji variant values like `💠=True`.
- **Preserve hash-suffixed property keys verbatim.** Non-variant component property keys carry a hash suffix Figma assigns: `Label#a1b2c3`, `Show icon#4d5e6f`, `Slot 1#7a8b9c`. Store the full key in `nonVariantProps[].key` **including the `#…` suffix**. Never strip, regenerate, or guess it — the suffix is required to set the property and is unique per definition.
- **Keep both token name forms.** Store the Figma slash-path in `figmaName` (`color/action/primary/background`) AND the dot-joined name in `name` (`color.action.primary.background`). Refresh re-matches on `figmaName`; the KB renders `name`.
- **Capture `codeSyntax` verbatim.** CSS custom-property names etc. are author-configured strings — store exactly as Figma returns them, no case folding.
- **Never mutate keys or node ids.** Keys are the refresh anchor; node ids are session scratch.

---

## 2. Paging fallback — decision procedure

The whole-system one-shot (`figma_get_design_system_kit`, console only) is the fastest path when it fits. But large systems blow past the MCP response cap, and a truncated kit is worse than no kit (silent missing components). Decide as follows:

```
STEP 2 — Whole-system attempt
├─ Is the "Whole-system one-shot" cell populated for this MCP profile?
│   ├─ NO  → skip step 2 entirely; go to step 3 (per-component). Log "one-shot: n/a".
│   └─ YES → call it once.
│       ├─ Call returns an MCP transport error containing any of:
│       │    "response too large" | "exceeds maximum" | "token limit" |
│       │    "truncated" | "MAX_TOKENS" | result byte size ≳ the MCP cap
│       │    → PAGING FALLBACK: discard the partial kit, go to step 3.
│       │      Record meta.incomplete += ["one-shot-oversized→paged"].
│       ├─ Call returns but the component array length < inventory count from step 1
│       │    (the cheapest truncation check — compare against the step-1 work queue)
│       │    → treat as truncated: PAGING FALLBACK to step 3 for the MISSING ids only.
│       └─ Call returns and component count == inventory count
│            → accept the kit; still run step 3 ONLY for any component whose
│              variant matrix or token bindings came back empty/partial.
```

**Why compare against inventory (step 1) and not trust the kit's own count:** the inventory pass is cheap and authoritative for *how many* components exist. The kit can silently drop the tail when it nears the cap. Always reconcile kit output against the inventory work queue; never assume the kit is complete because it didn't error.

**Per-component paging is itself resumable** — each component is written to the cache as it completes (see SKILL.md §Step 8), so a mid-fallback interruption resumes from the cache, not from zero.

---

## 3. What is NOT reliably extractable → flag, never invent

The hard discipline: Figma data is the only source. If a field is not in Figma's data model, the extractor **emits a flagged placeholder** and lets `ds-write` either scaffold a manual stub or run an explicitly-marked low-confidence synthesis. The extractor itself **never** writes prose intent, a11y rules, or relationships from model memory.

| Field | Why it's not in Figma | Extractor disposition |
|---|---|---|
| **Intent / when-to-use / when-NOT-to-use** | No Figma primitive for design intent. The `description` field *sometimes* holds it, often not. | Capture `description` verbatim if present. If absent → `flags.missingDescription: true`; leave intent empty. `ds-write` flags the section for **manual authoring** (or low-confidence LLM synthesis, marked as such). |
| **Most accessibility** (role, keyboard map, ARIA, contrast intent) | Not encoded in component structure. Only *derivable* hints exist (text-on-fill contrast can be computed; a focus-ring layer name implies focus handling). | Do NOT emit a11y prose. Capture only derivable signals (layer names like `Focus Ring`, computed fill/text contrast pairs) into the report. `ds-write` scaffolds a **manual** accessibility pattern file. |
| **`similar_to`** (cross-component similarity) | No Figma relationship. | Leave empty. → **low-confidence LLM synthesis** in `ds-write` (name/structure heuristic), or manual. Never asserted by the extractor. |
| **`deprecated_by` / deprecation** | **No Figma deprecation primitive at all.** | Scan the component name for prefixes `🚫`, `Deprecated`, `Old`, `[deprecated]` (see naming-conventions §Deprecation markers). Record the matched marker in `flags.namePrefix`. → **flag for manual confirmation**; never auto-set `deprecated_by`. |
| **Composition RULES** (e.g. "a Card must contain exactly one Header") | Figma only has *observed edges* (this instance contains that instance), not authored rules. | Emit only **observed edges** into `compositionEdges`. Authored composition *rules* are a **manual** pattern file. |
| **Unbound raw-hex colors** | A fill with no bound variable has no token — only a literal. | Emit the resolved literal into `variant.tokens[].literal` with `token: null`. Increment `flags.unboundColors` and `report.unboundColorVariants`. Never back-solve a token name from the hex. |

> **The rule in one line:** *If Figma's data model doesn't carry it, the extractor flags it — it does not fill the gap from memory.*

---

## 4. Atomic-composition metrics to capture

`ds-extract` does **not** classify atom/molecule/organism — that's `ds-write`'s job (`atomic-classification-rules.md`). The extractor's job is to capture the raw metrics the writer classifies from, per component (`component.composition`):

| Metric | Definition | How obtained |
|---|---|---|
| `instanceCount` | Total descendant INSTANCE nodes inside the component/default variant. | Walk descendants, count `type === 'INSTANCE'`. |
| `distinctChildComponents` | Count of unique main-component **keys** among those instances. | Dedup `getMainComponentAsync().key` (or set key). |
| `maxInstanceDepth` | Deepest instance nesting, **stopping at each instance boundary** (do not recurse into an instance's internal tree — see recipe E). | Track depth as you walk, reset at boundaries. |
| `childComponentKeys` | The deduped list of child main/set keys (feeds `compositionEdges`). | Collected during the walk. |
| `unresolvedMains` | Count of instances whose `getMainComponentAsync()` returned null (detached/missing/external-not-loaded). | Increment on null main. Drives `report.unresolvedInstanceMains` and lowers `ds-write` confidence. |
| `nonIconInstanceCount` | `instanceCount` minus icon/icon-wrapper instances. | Subtract instances whose main/set name matches an icon pattern (`Icon`,`*Icon`,`ResizableIcon`,`Glyph`,`Vector`,single-letter glyphs) or whose subtree is vector-only. |
| `distinctNonIconChildComponents` | Unique non-icon child keys. | Dedup `childComponentKeys` after removing icon primitives. |

**Icon-wrapper rule (load-bearing for classification):** a control that only wraps an icon — even two levels deep (`Control → <ResizableIcon> → X → Vector`) — is structurally an **atom**, not a molecule/organism. Emit `nonIconInstanceCount`/`distinctNonIconChildComponents` so `ds-write` classifies on the icon-excluded counts (see `atomic-classification-rules.md` → "Icon instances are primitives"). Still record the wrapped icon in `compositionEdges` / the component's `contains` — it's real composition, it just doesn't raise the level. This was the `<CloseButton>` miss caught in end-to-end testing.

Capture these **per variant** too where structure differs across variants (`variant.composedOf`) — inconsistent child sets across variants is exactly the signal `ds-write` uses to drop confidence (`needs_human_review`).

---

## 5. `figma_execute` fallback recipes (console / custom-with-escape-hatch only)

Use these **only** when a semantic tool returned a field incompletely AND the profile has the raw escape hatch (`mcp-tool-map.md` → "Raw escape hatch"). On `official`/`desktop`, these fields are flagged, not recovered.

### ⚠️ Cross-cutting gotchas (read before any recipe)
- **Page context resets between calls.** Every `figma_execute` starts on the file's first page. After `loadAllPagesAsync()` you must **re-resolve nodes by id** (`getNodeByIdAsync`) — never hold a node reference across calls. Node objects do not survive between `figma_execute` invocations.
- **Async setters/getters.** `getMainComponentAsync()`, `getVariableByIdAsync()`, `loadAllPagesAsync()`, `getNodeByIdAsync()` are all `await`-required. The sync forms are deprecated and silently return stale/null on unloaded pages.
- **Keys are stable; node ids are not.** Persist `key` everywhere; treat `nodeId` as session scratch (re-resolve from key on refresh).
- **Dedup async lookups.** `getVariableByIdAsync` per fill is expensive on big systems — cache resolved variables in a per-call `Map`.

### Recipe A — Enumerate every COMPONENT / COMPONENT_SET in the file
```js
// Inventory escape hatch when the semantic inventory tool under-reports
// (e.g. components on un-loaded pages).
await figma.loadAllPagesAsync();            // REQUIRED before findAllWithCriteria across pages
const nodes = figma.root.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
return nodes.map(n => ({
  name: n.name,                              // verbatim
  nodeId: n.id,                              // session scratch
  key: n.key,                                // STABLE anchor — persist this
  type: n.type,
  setId: n.type === 'COMPONENT' && n.parent?.type === 'COMPONENT_SET' ? n.parent.id : null,
  page: (() => { let p = n; while (p && p.type !== 'PAGE') p = p.parent; return p?.name ?? null; })(),
  w: Math.round(n.width), h: Math.round(n.height),
}));
```
> **Large files (≳50 pages): a single root-wide `findAllWithCriteria` times out at the ~30s bridge command cap.** Do `await figma.loadAllPagesAsync()` once, then iterate `figma.root.children` in **chunks of ~15 pages**, calling `page.findAllWithCriteria(...)` per page and concatenating — one `figma_execute` per chunk. This keeps every command under the ceiling. (Verified on a 75-page file where the whole-root scan failed twice.)

### Recipe B — Read variant axes + non-variant property definitions
```js
// COMPONENT_SET carries both the variant axes AND the non-variant prop defs.
await figma.loadAllPagesAsync();
const cs = await figma.getNodeByIdAsync('SET_NODE_ID');   // re-resolve by id after load
// Variant axes (the Property=Value matrix):
const axes = cs.variantGroupProperties;
//   → { Hierarchy: { values: ['Primary','Secondary'] }, Size: { values: ['SM','MD','LG'] }, ... }
// Non-variant props (TEXT / BOOLEAN / INSTANCE_SWAP / SLOT) — KEYS ARE HASH-SUFFIXED:
const defs = cs.componentPropertyDefinitions;
//   → { 'Label#a1b2c3': { type:'TEXT', defaultValue:'Button', ... },
//       'Show icon#4d5e6f': { type:'BOOLEAN', defaultValue:true },
//       'Slot 1#7a8b9c': { type:'INSTANCE_SWAP', defaultValue:'123:45', preferredValues:[...] } }
return {
  axes,
  nonVariantProps: Object.entries(defs)
    .filter(([k, d]) => d.type !== 'VARIANT')              // VARIANT entries are the axes, already captured
    .map(([key, d]) => ({ key, name: key.split('#')[0], type: d.type,
                          defaultValue: d.defaultValue, preferredValues: d.preferredValues ?? null })),
};
```

### Recipe C — Resolve `boundVariables` on fills / strokes / numeric fields
```js
// When the kit returned a bound color/spacing as a raw value with no token name.
await figma.loadAllPagesAsync();
const node = await figma.getNodeByIdAsync('VARIANT_NODE_ID');
const cache = new Map();                                  // dedup getVariableByIdAsync within this call
async function resolveVar(id) {
  if (cache.has(id)) return cache.get(id);
  const v = await figma.getVariableByIdAsync(id);         // await — required
  const out = v ? { token: v.name.replaceAll('/', '.'), figmaName: v.name, key: v.key, type: v.resolvedType } : null;
  cache.set(id, out);
  return out;
}
const out = [];
// Color fills/strokes:
for (const role of ['fills', 'strokes']) {
  const paints = node[role];
  if (Array.isArray(paints)) for (const p of paints) {
    const ref = p.boundVariables?.color;
    if (ref?.id) out.push({ role, ...(await resolveVar(ref.id)) });
    else if (p.type === 'SOLID') out.push({ role, token: null, literal: rgbToHex(p.color) }); // UNBOUND → literal + token:null
  }
}
// Numeric fields (spacing/radius):
for (const field of ['itemSpacing','paddingLeft','paddingRight','paddingTop','paddingBottom','topLeftRadius']) {
  const ref = node.boundVariables?.[field];
  if (ref?.id) out.push({ role: field, ...(await resolveVar(ref.id)) });
}
function rgbToHex(c){const h=x=>Math.round(x*255).toString(16).padStart(2,'0');return ('#'+h(c.r)+h(c.g)+h(c.b)).toUpperCase();}
return out;
```

### Recipe D — Walk descendant INSTANCEs WITHOUT crossing the instance boundary
```js
// Composition metrics. Record each child's main key + parent-set key, but DO NOT
// recurse into an instance's internal subtree — that internal structure belongs to
// the child component's own definition, not to this component's composition.
await figma.loadAllPagesAsync();
const root = await figma.getNodeByIdAsync('VARIANT_NODE_ID');
const childKeys = new Set();
let instanceCount = 0, unresolvedMains = 0, maxDepth = 0;
async function walk(node, depth) {
  for (const child of (node.children ?? [])) {
    if (child.type === 'INSTANCE') {
      instanceCount++;
      maxDepth = Math.max(maxDepth, depth + 1);
      const main = await child.getMainComponentAsync();         // await — required
      if (!main) { unresolvedMains++; continue; }                // detached/missing → flag, don't guess
      const setKey = main.parent?.type === 'COMPONENT_SET' ? main.parent.key : null;
      childKeys.add(setKey ?? main.key);
      // STOP — do not walk(child, ...). Boundary respected.
    } else {
      await walk(child, depth);                                  // keep walking non-instance frames
    }
  }
}
await walk(root, 0);
return { instanceCount, distinctChildComponents: childKeys.size,
         maxInstanceDepth: maxDepth, childComponentKeys: [...childKeys], unresolvedMains };
```

### Recipe E — Read library variable collections + modes + resolved values
```js
// When the token tool omitted modes or didn't resolve a VARIABLE_ALIAS.
await figma.loadAllPagesAsync();
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const out = [];
for (const col of collections) {
  const vars = [];
  for (const id of col.variableIds) {
    const v = await figma.getVariableByIdAsync(id);
    vars.push({
      name: v.name.replaceAll('/', '.'), figmaName: v.name, key: v.key, type: v.resolvedType,
      valuesByMode: v.valuesByMode,                              // may hold { type:'VARIABLE_ALIAS', id } — resolve via getVariableByIdAsync
      codeSyntax: v.codeSyntax ?? null, description: v.description || null,
    });
  }
  out.push({ collection: col.name, id: col.id,
             modes: col.modes.map(m => ({ name: m.name, id: m.modeId })), variables: vars });
}
return out;
```
> For published **library** collections (not local), use `figma.teamLibrary.getVariablesInLibraryCollectionAsync(collectionKey)` and `importVariableByKeyAsync` instead of the local-collection call above.

---

## 6. Output discipline — sharded cache & batched extraction

The cache is **sharded** so no single file (and no single agent read) holds the whole system. Write to `kb-output/.cache/`:

| File | Written by | `$def` |
|---|---|---|
| `meta.json` | orchestrator | `metaFile` |
| `inventory.json` | Step 1 | `inventoryFile` |
| `tokens.json` | token subagent (Step 4) | `tokensFile` |
| `icons-manifest.json` | Step 1b _(only if icons detected)_ | `iconsManifestFile` |
| `components/<slug>.json` | extraction subagents (Step 3), ONE per set | `component` |

- Every object with a `key` field must have it populated (the refresh anchor). A missing/empty `key` is a flag — list it in the report.
- Resolved literals for unbound colors go in `literal` with `token: null`. Never both null.
- `meta.incomplete` records every pass/component that didn't fully complete (oversized one-shot, unresolved mains over a threshold, escape hatch unavailable for a needed field).

### 6a. Write-and-release (why subagents)

The Figma plugin sandbox has **no filesystem** — data only reaches disk after the MCP returns it through the agent's context. So extraction runs in **subagents that hold the heavy JSON, write their own shards, and return one line.** The orchestrator only ever sees inventory rows and one-line summaries; it never holds a variant matrix. This is what removes the "whole cache must fit one context window" cap.

- **Batch small sets, isolate large ones.** Group sets with `approxVariantCount ≤ ~30` into one subagent (~10–12 sets); give any set >~150 variants its own subagent.
- **One `figma_execute` per batch**, looping over the batch's keys *inside the plugin* — not one call per component. Measured: ~45s for 12 components in one call vs ~120s for one component per call.
- **Concurrency ≈4** subagents in flight. Higher risks the ~30s bridge command timeout under contention.

### 6b. The auto-save escape hatch (never re-fetch a big result)

When a `figma_execute` return exceeds the MCP tool's output token cap, the Console MCP **auto-saves the full result to a file on disk** and the tool result reports that path. The subagent must **read that file** (and split it) rather than re-running the execute — re-running wastes a bridge call and risks the same cap. Rely on this deliberately for big batches: run the batched execute, then read the auto-saved result if the inline return was truncated.

### 6c. Variant sampling for giant sets

For a set above the row cap (config `max_variant_rows`, default ~250; opt out with `exhaustive_variants: true`):

- Always capture **full axis option lists** and the **true `totalVariantCount`**.
- Capture a **bounded representative sample** of variant rows (≤ ~40, covering axis boundaries/defaults), not every row.
- Set `variantSampling: "sampled"` on the shard (else `"full"`). ds-write and ds-refresh must surface a sampled matrix as partial, never as the complete set.

### Recipe F — One batched `figma_execute` over a set of keys (write-and-release)
```js
// Loop INSIDE the plugin over a batch of component-set node ids; return compact rows.
// The subagent then writes one components/<slug>.json per row and returns a one-line summary.
await figma.loadAllPagesAsync();
const SET_IDS = ['1:23', '1:45', '1:67'];        // this subagent's batch (re-resolved by id)
const MAX_ROWS = 250;                            // config max_variant_rows
const out = [];
for (const id of SET_IDS) {
  const cs = await figma.getNodeByIdAsync(id);
  if (!cs) { out.push({ id, error: 'node not found' }); continue; }
  const axes = cs.variantGroupProperties ?? {};
  const kids = cs.type === 'COMPONENT_SET' ? cs.children : [cs];
  const total = kids.length;
  const sampled = total > MAX_ROWS;
  const rows = (sampled ? kids.slice(0, 40) : kids).map(v => ({
    nodeId: v.id, key: v.key, name: v.name,      // name verbatim — round-trips into componentProperties
  }));
  out.push({
    id, name: cs.name, key: cs.key, type: cs.type, axes,
    totalVariantCount: total, variantSampling: sampled ? 'sampled' : 'full',
    variants: rows,
  });
}
return out;   // if oversized, read the MCP's auto-saved result file instead of re-running (§6b)
```

---

## 7. Tool quirks — verified against a real file (figma-console)

Confirmed end-to-end against a large production MUI-based design system (~530 components / 133 sets / ~5,000 variants / 1,439 tokens). Bake these into the protocol:

1. **The inventory's token count is UNRELIABLE — never gate the token pass on it.** `figma_get_design_system_summary` reported `tokens: 0` for a file that actually has **1,439 variables across 7 collections** (the variables live in collections the summary doesn't tally). Always run the dedicated token pass (`figma_get_variables`) regardless of what the summary says. Treat the summary as a *component* inventory only.

2. **The "component structure" tool is two tools, not one — call both.** `figma_get_component_details` returns the **variant matrix + axes + description + per-variant keys** but **NOT** token bindings, auto-layout, composition, or non-variant props. Those come from **`figma_get_component_for_development_deep`** (Desktop Bridge), which returns auto-layout, `reactions` (prototype state transitions), nested INSTANCE `mainComponent` refs, and **`boundVariables` already resolved to token names + collection + `codeSyntax`** (no manual id→name round-trip needed). Protocol: `details` for the matrix, then `…for_development_deep` on the default variant (and any variant whose structure differs) for tokens/layout/composition. Reserve raw `figma_execute` for what even the deep tool omits (e.g. resolving an INSTANCE `mainComponent.key` the deep tool left null — the `unresolvedMains` case).

3. **`reactions` are a free state-machine signal.** The deep tool surfaces prototype interactions like `ON_HOVER → <Hovered variant>`. Capture them in `component.reactions`; `ds-write` documents them in the variant file's State section instead of synthesizing transitions.

4. **Large sets are real.** `<Button>` has **680 variants**, `<IconButton>` 520. A `details` call on these is heavy — this is exactly why Tier-2 variant files exist and why the deep/token passes must be chunked per the paging procedure (§2).
