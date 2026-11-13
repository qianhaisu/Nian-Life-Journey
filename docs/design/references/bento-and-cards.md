# Bento & Cards Reference (Modular Daylight Canvas)

> **Benchmark Feel**: Amie.so crisp daylight modularity + Apple Journal warm editorial breathing room + Retro.app media-first card clarity.  
> **Primary Skills**: `make-interfaces-feel-better` (Surfaces, Icons), `impeccable` (layout, polish).

---

## 1. Canvas, Surfaces & Micro-Pastels

Nianlife separates figure from ground using cool daylight canvas `#F3F5F9` (`--color-bg`) and elevated pure white cards `#FFFFFF` (`--color-surface`), keeping micro-pastel tints strictly for semantic accents rather than saturated card fills:

| Role | Token (`v2/app/globals.css`) | Value | Usage Rule |
| --- | --- | --- | --- |
| Page Canvas | `--color-bg` | `#F3F5F9` | Global daylight backdrop |
| Elevated Card | `--color-surface` | `#FFFFFF` | Primary bento cards, month/day modules |
| Soft Inset | `--card-soft` / `--paper-dark` | `#EEF2F8` / `#EAEFF6` | Nested quiet blocks, secondary callouts |
| Blue Accent / Tint | `--brand-accent` / `--tint-blue` | `#2563EB` / `#EDF4FF` | Primary actions, Two Clocks kicker pill |
| Peach / Lavender / Mint Tints | `--tint-peach` / `--tint-lavender` / `--tint-mint` | `#FFF4EE` / `#F4F0FF` / `#ECFDF5` | Sparingly on semantic tags/badges with AA dark ink (`--accent-*`) |

---

## 2. Concentric Border Radius Rule

Every nested rounded container must share an optical center so corners never look pinched or unevenly weighted:

```text
innerRadius = max(6px, outerRadius - padding)
outerRadius = innerRadius + padding
```

- **Standard Bento Card**: `--r-card: 24px` (`26px` in `.home-v2` hero cards). With `8px–12px` card padding around media, set inner media/tile radius to `12px–16px` (`--r-media: 16px`), or use CSS `calc(var(--card-radius) - <padding>)` so values stay locked together.
- **Large Padding Exception**: When padding between outer card and an inner element exceeds `24px` (e.g., generous editorial whitespace inside an `860px` column), treat them as independent surfaces instead of forcing strict subtraction.
- **Pills & Badges**: Always full capsule (`--r-badge: 999px`) for status/Two-Clock tags and segmented tabs.

---

## 3. Shadows for Elevation, Borders for Structure

- **Cards & Floating Pills**: Use layered transparent ambient shadows (`--shadow`, `--shadow-hover`) plus ultra-subtle hairline (`--hairline: rgba(15, 23, 42, 0.06)`). Never stack heavy `2px` opaque borders to fake depth.
- **Dividers & Focus**: Keep `1px` borders (`--hairline-strong`) for list dividers, table/timeline separators, form inputs, and active/selected borders; reserve `2px solid var(--brand-accent)` (`outline-offset: 3px`) for `:focus-visible`.

---

## 4. Media Framing, CLS Prevention & Pure Neutral Outlines

- **Zero Layout Shift (CLS)**: Every photo/video container must reserve explicit dimensions or `aspect-ratio` (`aspect-ratio: 4 / 3`, `16 / 9`, or known intrinsic `width`/`height`) before images decode.
- **Pure-Black Inset Image Outline**: Apply a neutral `1px` inset outline on photos so bright skies or white backgrounds inside photos stay cleanly separated from `#FFFFFF` cards:
  ```css
  .media-frame img {
    outline: 1px solid oklch(0 0 0 / 0.1);
    outline-offset: -1px;
  }
  ```
  Never tint image outlines with slate, navy, or accent colors—tinted outlines make photo edges look muddy.
- **No Primary-Layer Counts**: Per `PRODUCT.md`, bento cards and photo grids must not surface raw media counts (`"10 photos"`, `"128 items"`) in the primary reading layer.

---

## 5. Optical Icon & Badge Alignment

- **Pill / Button with Text + Icon**: Reduce padding on the icon side by `2px` (`padding-inline: 16px 14px` when icon is on the right) so optical weight feels centered.
- **Play Triangle Inside Video Overlay**: Shift the triangle `+2px` toward the tip (`margin-left: 2px`) rather than relying on geometric `50%` centering.
- **Stroke Weight Consistency**: Use `lucide-react` at a single stroke weight per surface (`1.5px` beside 400 body text, `2px` beside 600–700 headings) driven by `currentColor`.

---

## Inspection Checklist

- [ ] Nested media/inner tiles satisfy `innerRadius = max(6px, outerRadius - padding)` (when padding `<= 24px`).
- [ ] Every card image frame has explicit `aspect-ratio` or `width`/`height` attributes (no CLS jump on load).
- [ ] Photo edges use `outline: 1px solid oklch(0 0 0 / 0.1); outline-offset: -1px` (no tinted border).
- [ ] Play buttons, back arrows, and icon+label pills look optically balanced rather than mechanically flush.
- [ ] Primary reading cards show Two Clocks (calendar date + child age) with zero engineering jargon or counts.
