# Design Cortex — Improvement Backlog

Derived from an end-to-end stress test against a large production MUI-based design system
(~530 components / 133 sets / ~5,000 variants / 1,439 tokens), run 2026-06-24. Each task traces
back to a numbered issue (I1–I9) from that run's "Issues found" summary. (The raw stress-test log
and its extracted output live in a local, git-ignored `Test/` folder — they contain proprietary
design-system data and are intentionally not published.)

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done. Priority tiers match the stress-test
prioritization (P0 = unlocks large systems at all; P0.5 = drain the cache fast; P1 = correctness
& cost; P2 = robustness & ergonomics).

**Issues (from the log):**
- **I1** Single-file `raw-extract.json` doesn't scale (multi-MB > one context window).
- **I2** Whole-file Plugin-API scans time out at the ~30–32s bridge command cap.
- **I3** Giant variant matrices (Button 680 / Chip 540 / IconButton 520 / Paper 468) are costly & risk the response cap.
- **I4** Icon explosion — 482 icons would become 482 folders and bloat `index.json`.
- **I5** `figma_get_design_system_summary` token counts lie (reported 0; real 1,439).
- **I6** Branch URLs — bridge treats a `/branch/` key as its own file; refresh is branch-scoped.
- **I7** Global-classification dependency — per-component-isolated writers can misclassify atom/molecule/organism.
- **I8** Icon-instance counting inflates composition counts (Rating=5 stars, etc.) → wrong promotions.
- **I9** Subagent startup overhead (~120s + ~19k tokens each) dominates cost 1-per-component.

---

## P0 — Unlocks large systems at all  *(DONE — implemented 2026-07-01)*

- [x] **P0-1 · Shard the cache** *(I1)* — Replace the single `.cache/raw-extract.json` contract with a sharded
      layout: `.cache/meta.json`, `.cache/inventory.json`, `.cache/tokens.json`, `.cache/icons-manifest.json`,
      and one `.cache/components/<slug>.json` per component set. Nothing heavy ever sits in orchestrator context.
      - Done: `shared/schemas/raw-extract.schema.json` restructured to per-file `$defs` (`metaFile`, `inventoryFile`,
        `tokensFile`, `iconsManifestFile`, `classificationFile`, `component`) with a legacy single-file fallback;
        `ds-extract` Steps 0/1/4/8, `ds-write` Step 1, `ds-refresh` Step 1/2, README/SETUP/md-schema updated.
- [x] **P0-2 · Subagent-written shards, one-line return** *(I1, I9)* — Extraction runs in subagents that write
      their own `.cache/components/<slug>.json` and return only a one-line summary; the heavy variant JSON stays
      in the subagent and goes straight to disk. Orchestrator holds only summaries.
      - Done: `ds-extract` Step 3 rewritten (batch small sets ~10–12/subagent, isolate large sets, concurrency ≈4).
- [x] **P0-3 · Batched `figma_execute` + auto-save file read** *(I9)* — One `figma_execute` per *batch* of
      components (loop inside the plugin), then read the MCP's auto-saved result file when the inline return
      exceeds the tool output cap — never re-fetch. ~45s/12 components vs ~120s/1.
      - Done: `extraction-rules.md` §6/§6a/§6b + Recipe F (batched execute) + auto-save escape hatch documented.
- [x] **P0-4 · Icons-manifest shard** *(I4, partial)* — ds-extract detects a large flat set of zero-variant,
      vector-only COMPONENTs (esp. on an "Icons"/"Iconography" page, siblings > ~50) and emits ONE
      `.cache/icons-manifest.json` (name · key · nodeId · size) instead of N component shards. ds-write renders
      it as a single collapsed `components/atoms/Icon/` entry. (Heuristic tuning → P1-3.)
      - Done: `ds-extract` Step 1b (detect + emit manifest, feed icon keys to Step 5 exclusion);
        `ds-write` Step 3/Step 6 render one `Icon/` manifest entry.

## P0.5 — Drain the cache fast  *(DONE — implemented 2026-07-01)*

- [x] **P0.5-1 · Fan out the entire ds-write across subagents** *(I1, I7)* — The write stage is pure local FS
      work (no Figma). Run it as: (1) ONE classifier subagent that reads only the `composition` fields of all
      shards → `.cache/classification.json` (global graph, levels, confidence); (2) N parallel component-writer
      subagents (each reads its shard + `classification.json` + `tokens.json`, writes `index.md` + `variants/*.md`);
      (3) parallel token-tree / patterns / `index.json` writers. Goal: drain `.cache/` shards into final markdown
      fast so the heavy cache can be discarded — the cache is transient staging, the markdown KB is the product.
      - Done: `ds-write` intro documents the classifier→writers fan-out; Step 2 = classifier subagent →
        `classification.json`; Steps 3/4/5/6 run as parallel index/token/patterns/component writer subagents.

> **Note:** Branch-URL detection (P2-2) and page-chunked inventory (P2-1) landed alongside P0 since they were
> inseparable from the touched steps. Remaining P2 items are still open below.

---

## P1 — Correctness & cost  *(DONE — implemented 2026-07-01, via 5 file-partitioned subagents)*

- [x] **P1-1 · Pipeline extract→write per component** *(I1)* — Cheap composition pre-scan built; extract→write may overlap.
      - Done: `ds-extract` Step 1c (child-instance-keys-only pre-scan → seeds `meta.json.compositionEdges` early);
        `extraction-rules.md` Recipe H (bounded default-variant walk); `ds-write` Steps 1/2 consume `compositionEdges[]`
        (shard-fallback) so a shard is writable as soon as it's on disk + the graph is known. Classifier stays authoritative.
- [x] **P1-2 · Variant-sampling cap** *(I3)* — Config knobs wired end-to-end.
      - Done: `.ds-kb-config.json(.example)` gain `max_variant_rows` (250) + `exhaustive_variants` (false);
        `ds-extract` Step 0 sets `meta.maxVariantRows = exhaustive_variants ? null : max_variant_rows`, Step 3 samples
        above the cap (full axis lists + `totalVariantCount` + ≤~40 rows, `variantSampling` flag); `extraction-rules.md`
        §6c + Recipe F honor it; `ds-write`/`md-schema.md` surface sampled matrices as "N of M variants".
- [x] **P1-3 · Icon-collapse heuristic tuning** *(I4)* — Detection formalized as a four-clause test.
      - Done: `ds-extract` Step 1b + `extraction-rules.md` Recipe G + `atomic-classification-rules.md` all agree:
        no property defs, zero descendant INSTANCEs, vector-only subtree, one of >~50 flat siblings on an icon page.
- [x] **P1-4 · Feed icon-manifest keys into icon-exclusion** *(I8)* — Icon instances excluded from level counts.
      - Done: an INSTANCE is an icon iff its main/set key ∈ icon-manifest key set OR name matches
        `/(^|[^a-z])icon($|[^a-z])|glyph|vector/i`; classification runs on `nonIcon*` counts; icon still recorded in
        `contains` but never raises the level (`ds-extract` Step 5 / Recipe D, `ds-write` Step 2, `atomic-classification-rules.md`).
- [x] **P1-5 · Per-variant token resolution (depth gap)** — Closed.
      - Done: `ds-extract` Step 3/4 capture `variant.tokens[] = [{role,token,key,type,literal}]` (deep-tool resolved
        `boundVariables`, Recipe C fallback); component `uses_tokens` = deduped dotted names; `ds-write` Step 6 renders
        per-option token rows with resolved values (unbound → literal, `token:null`, never invented). No more "not captured this pass".

## P2 — Robustness & ergonomics  *(DONE — completed 2026-07-01)*

- [x] **P2-1 · Page-chunked inventory** *(I2)* — Recipe A now documents the paged per-page traversal (~15 pages/call)
      and the ~30s bridge command ceiling; `ds-extract` Step 1 references it. *(landed with P0)*
- [x] **P2-2 · Branch-URL detection** *(I6)* — `ds-extract` Step 0.5 detects `/branch/`, records `meta.branchKey` +
      `meta.parentFileKey`, and warns; `ds-refresh` Step 1 enforces branch-scoped re-extraction. *(landed with P0)*
- [x] **P2-3 · Stop trusting summary token counts** *(I5)* — `ds-extract` Step 1 + `extraction-rules.md §7.1` already
      warn never to gate the token pass on the summary; reinforced in Step 1. *(covered)*
- [x] **P2-4 · Concurrency guidance** — Documented: run ≈4 extraction subagents in flight (4–6 max), one batched
      `figma_execute` each; higher risks the ~30s bridge command timeout. Stated in `ds-extract` Step 1d + Step 3 +
      `extraction-rules.md §6a`.
- [x] **P2-5 · Budget awareness** — `ds-extract` Step 1d prints an order-of-magnitude cost estimate from the inventory
      counts (≈3–4k tokens/set + ~80–90k token pass + ~20k icons → ~450–500k for a ~130-set/~5k-variant system) and
      offers scoping (full / subset / breadth-shallow) before committing; subset/shallow are recorded in `meta.incomplete`.
