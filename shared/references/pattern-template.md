---
type: pattern
name: REPLACE-pattern-name
source: manual
last_updated: "YYYY-MM-DD"
---

# REPLACE Pattern Name

> These rules cannot be inferred from Figma structure. They are maintained by the design system team.
> `ds-refresh` never overwrites files marked `source: manual`.

## REPLACE Rule Group

- State the rule plainly, as an instruction an agent can follow.
- Reference components by their KB name (e.g. "use the Danger Button variant").
- Reference tokens by their dotted name (e.g. `color.feedback.danger.background`).

## Examples to author here

Intent-level rules the design team owns:

- **Destructive actions** — always require a confirmation step; use the Danger Button variant; confirmation pattern is a Popup with explicit Delete/Cancel actions.
- **Empty states** — every empty state includes a primary CTA; use the EmptyState organism, not a custom layout.
- **Error states** — form validation errors appear inline below the affected Input; page-level errors use the Alert organism with `type="error"`; never use a Popup for errors unless user action is required.
- **Modals** — never show two modals simultaneously.
- **Brand voice** — button labels are verbs in sentence case ("Save changes", not "SAVE CHANGES").
