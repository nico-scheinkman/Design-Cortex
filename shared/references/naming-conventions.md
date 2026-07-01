# Naming Conventions

How the generator names files and folders, and how it normalizes Figma names.

## Folder & file names

| Thing | Convention | Example |
|---|---|---|
| Component folder | PascalCase, slugified | `Button/`, `SearchField/` |
| Variant group file | kebab-case of the Figma property name | `icon-position.md` |
| Token category folder | lowercase | `color/`, `typography/` |
| Token group file | kebab-case | `action.md`, `feedback.md` |
| Atomic level folder | lowercase plural | `atoms/`, `molecules/`, `organisms/` |
| Screenshot | `<variant-slug>.png` beside the component | `primary-md-default.png` |

## Slugifying Figma names

Figma names are often messy — emoji prefixes, spaces, `/` separators, deliberate missing spaces. Normalize for **paths only**; always preserve the raw name verbatim in data.

1. Strip leading status/category emoji and symbols (`✅ `, `🚫 `, `⚡ `, `💠`).
2. For component **folder** names: take the COMPONENT_SET name, PascalCase it, drop spaces and punctuation. `Section Header` → `SectionHeader`.
3. For variant **group file** names: kebab-case the property name. `Icon Position` → `icon-position`.
4. Replace `/` with `-` (Figma uses `/` for grouping in style/variable names).
5. Collapse repeated separators; trim.
6. If two components slugify to the same folder, append a short disambiguator from the page name.

**Never** mutate:
- Variant **value** strings (used to set `componentProperties` — must match Figma exactly, including deliberate missing spaces like `Label +Full width Input`).
- Component **keys** and **node ids**.
- Token names (stored as the dotted/`/`-path Figma uses, e.g. `color.action.primary.background`).

## Token name normalization

Figma variable names use `/` (e.g. `color/action/primary/background`). The KB stores them dot-joined (`color.action.primary.background`) in `uses_tokens` and token tables, but keeps the original `/` form in a `figma_name` field so refresh can re-match. Code-syntax names (CSS custom properties etc.) are stored verbatim from Figma's configured code syntax.

## Deprecation markers

Figma has no deprecation primitive. The generator treats these name prefixes as deprecation signals (configurable): `🚫`, `Deprecated`, `Old`, `[deprecated]`. Matched components get `deprecated_by` flagged for human confirmation, not auto-applied.
