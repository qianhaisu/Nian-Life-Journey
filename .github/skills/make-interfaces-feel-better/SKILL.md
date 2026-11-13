---
name: make-interfaces-feel-better
description: >-
  Nianlife-adapted design engineering skill (from jakubkrehel/make-interfaces-feel-better)
  for UI polish, concentric radii, optical alignment, shadows vs borders, typography/CJK
  wrapping, icons, hit areas, and interruptible micro-interactions. Supports quick (<=5)
  and full (<=15) review modes.
---

# Make Interfaces Feel Better (Nianlife Edition)

Adapted from `jakubkrehel/make-interfaces-feel-better` (`SKILL.md`, `typography.md`, `surfaces.md`, `animations.md`, `icons.md`, `performance.md`) for Nianlife V2's **Modular Daylight Canvas** (`#F3F5F9` canvas, `#FFFFFF` cards, plain CSS custom properties in `v2/app/*.css`, self-hosted Poppins/Nunito + CJK system sans).

Before suggesting or writing any fix, identify the target file's existing styling system (scoped plain CSS tokens in `v2/app/*.css` or Tailwind utilities where already used) and express changes in that system. Never introduce a second styling system, external font CDN, or heavy animation library just to apply a polish fix.

When inspecting motion or state transitions, slow playback down (10% speed in browser DevTools Animations panel) and walk every state: default, hover, focus-visible, active, loading, empty, and reduced-motion.

## Core Principles (Nianlife-Adapted)

### 1. Concentric Border Radius
Nested rounded surfaces must share an optical center:
- `outerRadius = innerRadius + padding` (or `innerRadius = max(6px, outerRadius - padding)`).
- Align with Nianlife tokens (`--r-card: 24px` / `26px`, `--r-media: 16px`, `--r-badge: 999px`).
- If padding between surfaces exceeds `24px`, treat them as independent surfaces rather than forcing strict concentric math.

### 2. Optical Over Geometric Alignment
- When geometric centering looks uneven (play triangles, arrows, asymmetric icons, badge + text pills), adjust optically.
- Buttons/pills with text + icon: `icon-side padding = text-side padding - 2px`.
- Play triangles inside circular/rounded media overlays: nudge right (`margin-left: 2px` or adjusted SVG `viewBox`).
- Fix asymmetric SVG geometry in the icon itself first; use 1px margin only as fallback.

### 3. Shadows for Elevation, Borders for Structure & Neutral Image Outlines
- Use layered transparent `box-shadow` (`--shadow`, `--shadow-hover`) for elevation on cards, floating pills, and popovers.
- Reserve `1px` borders (`--hairline`, `--hairline-strong`) for structural dividers, form inputs, and active/selected/focus states.
- Add a subtle inset outline on photos/media so light edges never bleed into `#FFFFFF` or `#F3F5F9`:
  - Light mode: `outline: 1px solid oklch(0 0 0 / 0.1); outline-offset: -1px;` (pure black at 10% opacity — never tinted slate/accent).

### 4. Typography, Two Clocks & CJK Line-Wrapping
- Root font smoothing: `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;` at the document root.
- **Tabular numbers**: apply `font-variant-numeric: tabular-nums` (or `lining-nums tabular-nums`) on Two Clocks dates/ages, health measurements, timeline markers, and any updating counters.
- **Heading wrapping**: `text-wrap: balance` on headings (`h1`–`h4`, <= 6 lines) so Chinese/bilingual titles break evenly.
- **Body wrapping**: `text-wrap: pretty` on short-to-medium paragraphs, captions, and quotes (`p`, `figcaption`, `blockquote`) to avoid 1–2 character CJK orphans on the last line; leave long 10+ line essays default.
- **Mobile CJK resilience (`390x844`)**: verify `keep-whole` / `white-space: nowrap` pills wrap cleanly as flex items (`flex-wrap: wrap`) and never cause horizontal overflow (`scrollWidth <= clientWidth`).

### 5. Minimum Hit Area & Touch Ergonomics
- Touch/mobile controls: **minimum `44x44px`** hit area. Dense desktop-only controls: **minimum `40x40px`**.
- If a visible icon, close button, or indicator is smaller, extend the hit target with a centered `::after` pseudo-element (`width: 44px; height: 44px`).
- Never allow extended hit areas of adjacent buttons/links to overlap.

### 6. Icons (`lucide-react` / inline SVG)
- Use one SVG driven by `currentColor`; style hover, pressed, active, and disabled states via CSS rather than swapping separate colored SVG files.
- Match stroke weight to adjacent text weight (`1.5px` beside 400 regular, `2px` beside 600 semibold). Never mix icon families on one surface.
- Outline icon for default state; filled icon (or tinted pill) for active/selected state.
- Every icon-only control needs an accessible name (`aria-label`); decorative icons get `aria-hidden="true"`.

### 7. Interruptible, Restrained Motion & Performance
- Prefer CSS `transition` over `@keyframes` for interactive state changes so rapid clicks/hovers retarget smoothly instead of restarting.
- Never use `transition: all`; list exact GPU-compositable properties (`transform`, `opacity`, `filter`).
- Use `will-change: transform` sparingly, only to fix observed first-frame stutter.
- Button press feedback: `transform: scale(0.96)` (never smaller than `0.95`); omit on static/distraction-free reading controls.
- Contextual icon swaps (without `motion` installed): keep both icons in the DOM (one `position: absolute`) and cross-fade with `opacity`, `scale(0.25 -> 1)`, `blur(4px -> 0px)` using `cubic-bezier(0.2, 0, 0, 1)`.
- Staggered entrances (`~100ms` step) and subtle exits (`translateY(-12px)`, `150ms ease-out`) are reserved for infrequent views — never stagger routine tab switches, list rows, or thumbnail grids.

## Nianlife Guardrails (Mandatory)
- **Privacy**: never paste child photos, personal health details, raw family text, or signed media URLs into skill outputs, examples, or tracked docs.
- **Product principles**: never introduce counts in the primary reading layer, never add external font CDNs, and respect `prefers-reduced-motion`.

## Review Modes & Output Format

Default to `full` when no mode is requested.

| Mode | Scope & Severity Filter | Max Findings |
| --- | --- | --- |
| `quick` | Primary user path & highest-traffic states (`HIGH` and `MEDIUM` only) | 5 |
| `full` | Entire target across Typography, Surfaces, Animations, Icons, Performance (`HIGH`, `MEDIUM`, `LOW`) | 15 |

- `HIGH`: inaccessible, unreadable, broken hit area/focus, horizontal overflow, or repeatedly disruptive.
- `MEDIUM`: clear visual inconsistency, concentric/alignment defect, or janky non-composited transition.
- `LOW`: isolated craft polish (reported in `full` mode only).

### 1. Scope and Coverage
State the mode (`quick` or `full`), exact files/routes inspected, styling system, and fill all 5 categories:

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Files / checks run | `<n> findings` / `Clear` / `Not reviewed (reason)` |
| Surfaces | Files / checks run | `<n> findings` / `Clear` / `Not reviewed (reason)` |
| Animations | Files / checks run | `<n> findings` / `Clear` / `Not reviewed (reason)` |
| Icons | Files / checks run | `<n> findings` / `Clear` / `Not reviewed (reason)` |
| Performance | Files / checks run | `<n> findings` / `Clear` / `Not reviewed (reason)` |

### 2. Findings
Group by principle. Use a markdown table with **Position** (`path/to/file:line` or screen + component), **Before**, **After**, and **Why** (include **Severity** when triaging). Never write separate `Before:` / `After:` lines. Consolidate repeated systemic issues into one row listing all affected locations.

| Severity | Position | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `v2/app/home.css:124` | `border-radius: 16px` inside `24px` card (`p: 12px`) | `border-radius: 12px` (`24 - 12`) | Concentric radius prevents pinched corners |

### 3. Considered but Rejected
List `1–3` real borderline candidates in `quick` mode or `2–5` in `full` mode (never invent filler):

| Position | Candidate | Rejected because |
| --- | --- | --- |
| `v2/app/home.css:25` | Increase card shadow opacity | Matches shared `--shadow` daylight token across sibling routes |

### 4. Verification and Verdict
1. **Verification**: list exact commands/browser checks run and observed outcomes (or mark **Not verified** with what remains).
2. **Verdict**: `Block` (any `HIGH` remains), `Needs changes` (only `MEDIUM`/`LOW` remain), or `Approve` (no actionable findings). If zero findings, omit the Findings table and state `"No actionable interface-polish findings."`.
