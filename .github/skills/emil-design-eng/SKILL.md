---
name: emil-design-eng
description: >-
  Nianlife-adapted design engineering skill (from emilkowalski/skills/emil-design-eng)
  encoding frequency-first motion gating, purpose checks, GPU-composited transform/opacity
  rules, easing/duration limits, popover/tooltip behavior, and reduced-motion accessibility.
---

# Emil Design Engineering (Nianlife Edition)

Adapted from `emilkowalski/skills` (`skills/emil-design-eng/SKILL.md`) for Nianlife V2's **Modular Daylight Canvas** — a calm, family-facing digital life archive built with React/Next.js and plain CSS custom properties (`v2/app/*.css`, no Framer Motion dependency installed).

Unseen details compound: when interactions respond with physical clarity and zero sluggishness, the interface recedes and family memories lead.

## 1. The Animation Decision Gate (Run in Order)

### Step A — Frequency-First Motion Gate
Ask: *How often will a family member trigger or see this interaction?*

| Frequency | Examples in Nianlife | Decision |
| --- | --- | --- |
| **100+ times/day or keyboard-initiated** | Escape to close PhotoViewer, arrow-key navigation in Atlas/Viewer, rapid month switching | **No animation** (or instant swap). Keyboard actions must never feel delayed. |
| **Tens of times/day** | Top nav links, filter/year pills, card hovers, list row focus | **Remove or drastically reduce** (`<= 150ms` subtle color/opacity/shadow; no spatial bounce). |
| **Occasional** | Opening PhotoViewer lightbox, health attachment modal, drawers, toast feedback | **Standard animation** (`150–250ms` crisp ease-out, under `300ms` UI ceiling). |
| **Rare / First-time** | First reveal of empty states or seasonal/annual milestone highlights | **Subtle delight allowed**, never blocking interaction. |

### Step B — Purpose Gate: "What does motion help the user understand?"
Every animation must answer this with a concrete UX purpose:
- **Spatial consistency**: PhotoViewer/drawer enters and exits along a predictable axis/origin.
- **State indication**: active tab/pill indicator or health check state change clearly signals selection.
- **Tactile feedback**: press scale (`scale(0.96–0.97)`) confirms a tap/click was received.
- **Preventing jarring cuts**: soft opacity/scale transition (`scale(0.95)` -> `1`) avoids sudden visual pops.

If the only answer is *"it looks cool"* and the element is seen frequently, **do not animate it**.

## 2. GPU-Only Performance & CSS Rules

- **Animate only `transform` and `opacity`** (plus `clip-path` or lightweight `filter: blur(<= 2px)` only where strictly needed).
- **Never animate layout properties**: no transitions on `width`, `height`, `padding`, `margin`, `top`, `left`. Example: animate a nav underline via `transform: scaleX(...)` instead of `width: 0 -> 100%`.
- **Never use `transition: all`**: always declare exact properties (e.g., `transition: transform 180ms var(--ease-spring), opacity 160ms ease-out`).
- **Avoid mutating inherited CSS variables on parent containers** during scroll/drag (triggers style recalculation on every descendant); update `transform` directly on the target element.
- **Prefer CSS transitions over `@keyframes`** for any interactive control so rapid user clicks interrupt and retarget smoothly instead of snapping back to frame zero.

## 3. Easing, Timing & Component Mechanics

### Custom Curves & Speed Limits
Built-in `ease-in` is **forbidden** on UI entrances/exits because its slow start feels laggy right when the user clicks.
- Use strong `ease-out` / spring curves already tokenized in `v2/app/globals.css`:
  - `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)` (or `cubic-bezier(0.23, 1, 0.32, 1)` for crisp Vercel/Sonner-style responses)
  - `--ease-out: cubic-bezier(0.25, 1, 0.5, 1)`
- **Durations**:
  - Press feedback (`:active`): `100–160ms`, `transform: scale(0.97)`
  - Tooltips & small popovers: `125–200ms`
  - Dropdowns & segmented switches: `150–250ms`
  - Modals & PhotoViewer backdrop/content: `200–300ms` (exit faster/softer than enter, e.g., `150–200ms` out vs `240ms` in)

### Popovers, Tooltips & Modals
- **Never animate from `scale(0)`**: start entrances from `scale(0.95)` + `opacity: 0` (or `@starting-style` / mounted state).
- **Origin awareness**: popovers and menus scale from their trigger (`transform-origin` toward trigger); centered viewport **modals stay `transform-origin: center`**.
- **Tooltip delay rule**: apply an initial hover delay (e.g., `300–500ms`) before showing the first tooltip to prevent accidental flashes; once a tooltip is open, hovering adjacent tooltips must skip both delay and animation (`0ms`, e.g., `data-instant`) so toolbar scanning feels instantaneous.

## 4. Touch Devices & `prefers-reduced-motion`

- **Hover isolation**: gate hover lift/scale animations behind `@media (hover: hover) and (pointer: fine)` so touch taps on iOS/Android do not stick in a hover state.
- **Reduced motion (`prefers-reduced-motion: reduce`)**:
  - Remove spatial movement (`transform`, `translate`, `scale`, parallax, stagger offsets).
  - **Preserve gentle opacity/color state transitions** (`120–200ms ease`) that aid comprehension — do **not** blanket-override all transitions to `0.01ms !important` if doing so erases essential focus/selection state clarity.

## 5. Review Format (Required)

When reviewing UI motion or component interactions, output a single markdown table with **Existing**, **Suggested**, and **Reason** columns (never separate multi-line `Before:` / `After:` blocks). One row per finding (consolidating identical repeated patterns across a file with line citations):

| Existing | Suggested | Reason |
| --- | --- | --- |
| `v2/app/globals.css` nav `::after` transitions `width` | Animate `transform: scaleX(0 -> 1)` with `transform-origin: center` | GPU-composited transform avoids layout recalc on every hover |
| Global `* { transition-duration: 0.01ms !important }` under reduced-motion | Disable transforms/keyframes while keeping `150ms` opacity/color cues | Preserves comprehension cues without spatial motion sickness triggers |
| Dropdown enters with `scale(0)` and `ease-in` 350ms | Enter from `scale(0.95); opacity: 0` with `180ms cubic-bezier(0.23, 1, 0.32, 1)` | Nothing appears from zero; `ease-out` starts fast and stays under 300ms |
| Hover scale applied unconditionally | Wrap in `@media (hover: hover) and (pointer: fine)` | Prevents sticky hover states after taps on mobile phones |
| Tooltip repeats 400ms delay between adjacent controls | Skip delay & animation (`0ms`) while another tooltip is active | Makes scanning adjacent controls feel instant without false triggers |

## Nianlife Privacy & Scope Guardrail
Never reference or copy real child photos, health records, family chat excerpts, or signed URLs in review examples or verification notes.
