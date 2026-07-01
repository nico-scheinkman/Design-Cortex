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

> **Note (P1 groundwork laid, not fully implemented):** the schema now carries `variantSampling` / `maxVariantRows`
> (P1-2) and the icon-exclusion `nonIcon*` counts (P1-4), and extraction-rules §6c documents the sampling policy —
> but the config knobs (`max_variant_rows`, `exhaustive_variants`) are not yet wired into `.ds-kb-config.json`.
> Branch-URL detection (P2-2) and page-chunked inventory (P2-1) landed alongside P0 since they were inseparable
> from the touched steps. Remaining P1/P2 items are still open below.

---

## P1 — Correctness & cost  *(not yet)*

- [ ] **P1-1 · Pipeline extract→write per component** *(I1)* — Pair each component's Figma fetch with writing its
      `.md`, building the KB while scanning; keep the shard as the refresh anchor. Requires a cheap composition
      pre-scan first so classification's global graph is known before the paired pipeline runs.
- [ ] **P1-2 · Variant-sampling cap** *(I3)* — Config knob `max_variant_rows` (default ~150–250) + `exhaustive_variants`
      opt-out. For big sets capture full axis option lists + total count + a bounded representative sample
      (≤~40 rows), and record `variantSampling: "full" | "sampled"` per shard so ds-write/refresh know the matrix is partial.
- [ ] **P1-3 · Icon-collapse heuristic tuning** *(I4)* — Formalize the detection heuristic in ds-write
      (no component-property defs, no child instances, vector-only, siblings > 50) beyond the P0-4 manifest hookup.
- [ ] **P1-4 · Feed icon-manifest keys into icon-exclusion** *(I8)* — Pass the icon-manifest key set into the
      composition/classification step so wrapped-icon instances (Rating=5 stars, List/TransferList=12, Sidenav=15)
      don't inflate counts and wrongly promote atoms to molecules/organisms.
- [ ] **P1-5 · Per-variant token resolution (depth gap)** — Resolve per-variant `boundVariables → token` (currently
      `uses_tokens: []` / "Tokens: not captured this pass"). Needs a per-variant node read; fold into the P1-1 pipeline.

## P2 — Robustness & ergonomics  *(not yet)*

- [x] **P2-1 · Page-chunked inventory** *(I2)* — Recipe A now documents the paged per-page traversal (~15 pages/call)
      and the ~30s bridge command ceiling; `ds-extract` Step 1 references it. *(landed with P0)*
- [x] **P2-2 · Branch-URL detection** *(I6)* — `ds-extract` Step 0.5 detects `/branch/`, records `meta.branchKey` +
      `meta.parentFileKey`, and warns; `ds-refresh` Step 1 enforces branch-scoped re-extraction. *(landed with P0)*
- [x] **P2-3 · Stop trusting summary token counts** *(I5)* — `ds-extract` Step 1 + `extraction-rules.md §7.1` already
      warn never to gate the token pass on the summary; reinforced in Step 1. *(covered)*
- [ ] **P2-4 · Concurrency guidance** — Document keeping bridge concurrency ≈4 (higher risks the 30s timeout).
- [ ] **P2-5 · Budget awareness** — Surface an up-front cost estimate (a full extract of a ~5k-variant system
      ≈ 450–500k tokens) so the user can scope (subset / breadth-shallow / full) before committing.
