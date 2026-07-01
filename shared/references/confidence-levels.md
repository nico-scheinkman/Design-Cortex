# Confidence Levels

Every component carries a `confidence` value in its frontmatter and in `index.json`. It tells a consuming agent how much to trust the auto-generated classification and metadata.

| Level | Meaning | Agent behavior |
|---|---|---|
| `high` | Cleanly extracted and classified; structure consistent across variants | Trust fully |
| `medium` | Extracted, but with one soft signal (e.g. some variants missing descriptions, one inconsistent variant) | Trust structure; verify intent fields |
| `low` | Auto-extracted with a known gap (intent synthesized, no token bindings, ambiguous code mapping) | Treat intent/usage as a starting point, verify against Figma if it matters |
| `needs_human_review` | Could not be classified with confidence; placed in `_review/` | Do not rely on classification; the component is real but its atomic level is unassigned |

## What lowers confidence

- **Structure varies across variants** — different child-instance sets per variant → classification is unstable.
- **Unresolved instance mains** — nested instances whose main component couldn't be resolved (detached/missing) make the `contains` count untrustworthy.
- **Boundary straddle** — exactly 4 child components, or a count that says molecule but depth that says organism.
- **Category-not-atom** — a single COMPONENT_SET whose variants are really distinct element types (e.g. a `Type=Heading|Button|Image…` set). Count says atom; semantics say category. → `needs_human_review`.
- **Synthesized intent** — `When to Use` / `When NOT to Use` derived by the model rather than read from a Figma description → that section is marked, component drops to at most `medium`.
- **No token bindings** — component uses raw hex everywhere, no variables bound → token data is literal-only, flagged.
- **Ambiguous code mapping** — Code Connect returns a low-confidence or multiple matches → `has_code_mapping` true but `confidence` capped at `medium`.

## How confidence is set

`ds-write` computes it during classification (see `skills/ds-write/references/atomic-classification-rules.md`). The extraction report from `ds-extract` lists every component that will land below `high` so the user knows what to review.
