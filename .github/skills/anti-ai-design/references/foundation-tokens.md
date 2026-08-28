# Foundation Tokens

Prompt-optimized foundation contract for `anti-ai-design`. Use this reference to freeze a screen's shared visual DNA once, then reuse it across subsequent screens without drift.

## Why This Reference Exists

A visually coherent multi-screen design needs more than style labels. Once screen 1 establishes the brand and material system, later screens must reuse the same token values instead of re-inventing them. This file defines the token contract that the skill must freeze, output, and inject across screens.

## Token Freeze Protocol

### When to Freeze
- Freeze the foundation immediately after the **first approved or generated screen** for a project.
- Freeze before generating screen 2.
- If the user starts with an existing brand/system, derive the frozen block from that brand instead of inventing new values.

### What Freeze Means
- Extract the exact CSS custom properties used to express the design's shared visual system.
- Treat the frozen block as the single source of truth for subsequent screens.
- Later screens may add component-local variables, but they must not silently replace the frozen core tokens.

### Output Requirement
After screen 1, output a visible token block the model can carry forward:

```css
/* FROZEN FOUNDATION TOKENS — inject into all subsequent screens */
:root {
  --color-primary: <exact value>;
  --color-secondary: <exact value>;
  --color-accent: <exact value>;
  --color-bg: <exact value>;
  --color-surface: <exact value>;
  --color-text: <exact value>;
  --color-muted: <exact value>;
  --color-border: <exact value>;
  --font-heading: <exact font stack>;
  --font-body: <exact font stack>;
  --radius-sm: <exact value>;
  --radius-md: <exact value>;
  --radius-lg: <exact value>;
  --radius-xl: <exact value>;
  --space-1: <exact value>;
  --space-2: <exact value>;
  --space-3: <exact value>;
  --space-4: <exact value>;
  --space-6: <exact value>;
  --space-8: <exact value>;
  --shadow-style: <exact value or descriptive token>;
  --density: <compact | balanced | spacious>;
}
```

State explicitly: **Foundation tokens frozen. All subsequent screens will use these exact values unless the user explicitly requests a token change.**

## Mandatory Token Set

These tokens form the minimum reusable design contract.

### Color Tokens
- `--color-primary` — primary brand/action color
- `--color-secondary` — secondary support color
- `--color-accent` — highlight or emphasis color
- `--color-bg` — page background
- `--color-surface` — panel/card/sheet background
- `--color-text` — primary text color
- `--color-muted` — subdued text/supporting UI color
- `--color-border` — divider/border color

### Typography Tokens
- `--font-heading` — heading/display stack
- `--font-body` — body stack

### Radius Tokens
- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--radius-xl`

### Spacing Tokens
- `--space-1`
- `--space-2`
- `--space-3`
- `--space-4`
- `--space-6`
- `--space-8`

### Foundation Meta Tokens
- `--shadow-style` — shared shadow logic or shadow token reference
- `--density` — compact, balanced, or spacious

## Style-Aware Mapping Notes

### From Unified Styles
When a style is selected, map its concrete fields into the frozen token block:
- `colorPalette.primary` → `--color-primary`
- `colorPalette.secondary` → `--color-secondary`
- `colorPalette.accent` → `--color-accent`
- `colorPalette.bg` → `--color-bg`
- `colorPalette.text` → `--color-text`
- style surface/background treatment → `--color-surface`
- style typography.heading/body → `--font-heading` / `--font-body`
- layout.borderRadius → radius scale starting point
- layout.shadowStyle → `--shadow-style`
- layout.density → `--density`

### From Existing Brand Context
If the repo or brief already exposes real brand variables, prefer those over style defaults, as long as they still satisfy contrast and platform-fit rules.

## Injection Rules for Later Screens

- Every screen after screen 1 must inject the frozen `:root {}` block **verbatim** at the top of its `<style>` section.
- Inject the block before any component styles.
- Component styles must reference the frozen variables rather than duplicating hex values or ad-hoc spacing/radius values.
- If a later screen requires a local exception, define a component-local variable derived from the frozen token rather than replacing the root token.

### Acceptable Pattern
```css
:root {
  --color-primary: #2d2d2d;
  --radius-lg: 0.75rem;
}

.card {
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-style, 0 4px 20px rgba(0,0,0,0.12));
}
```

### Forbidden Pattern
```css
.card {
  border-radius: 22px;
  background: #f7f1ea;
  color: #2a2620;
}
```

If those values belong to the shared system, they must come from the frozen token block.

## Cross-Screen Consistency Rules

- Screen 2+ must keep the same palette family, font pairing, spacing rhythm, radius language, and density unless the user explicitly requests a token change.
- A new screen may vary layout, emphasis, or content hierarchy, but it should still look like the same product family.
- Platform changes may alter structure (for example bottom nav vs sidebar), but not the shared visual identity.
- Recovery changes must preserve the frozen foundation unless the recovery request targets a token dimension directly.

## Recovery and Token Updates

### If the user changes color
- Update only the relevant color token(s).
- Re-output the updated frozen block.
- Preserve typography, spacing, density, and radius unless asked otherwise.

### If the user changes typography
- Update `--font-heading` and/or `--font-body`.
- Preserve colors, spacing, radius, and density.

### If the user changes layout only
- Keep the frozen tokens unchanged.
- Regenerate structure and component arrangement only.
- Preserve existing color palette, typography pairing, spacing rhythm, density, and interaction language unless the user explicitly requests a change to one of those dimensions.

### If the user changes spacing or radius
- Update the affected spacing or radius tokens.
- Re-output the updated frozen block and reuse it on later screens.

## Validation Rules

- Do not freeze low-contrast foreground/background pairs.
- Do not freeze mixed icon families into the same design system.
- Do not freeze arbitrary one-off values that appear only once and do not represent the shared system.
- Do not silently drift from the frozen token values in later screens.
- If a token is unknown, derive it from the selected style's concrete visual DNA instead of inventing a disconnected value.

## Practical Generation Checklist

Before moving from screen 1 to screen 2, check:
- Have the shared colors been turned into reusable variables?
- Are heading/body fonts explicitly frozen?
- Is the radius/shadow language stable enough to describe the same brand?
- Does spacing follow a repeatable rhythm rather than ad-hoc values?
- Can the next screen reuse this block verbatim and still look consistent?

## Fast Prompt Reminder

- Freeze once.
- Reuse verbatim.
- Change only the requested token dimension.
- Never hardcode a second design system on later screens.
