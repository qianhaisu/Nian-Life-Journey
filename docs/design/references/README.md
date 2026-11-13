# Nianlife V2 Visual Reference & SOP Kit

> **Scope**: Lightweight visual craft reference and browser verification SOP for Nianlife V2's **Modular Daylight Canvas** (`DESIGN.md`, `PRODUCT.md`).  
> **Skills Paired**: [`.github/skills/impeccable/SKILL.md`](../../../.github/skills/impeccable/SKILL.md), [`.github/skills/make-interfaces-feel-better/SKILL.md`](../../../.github/skills/make-interfaces-feel-better/SKILL.md), [`.github/skills/emil-design-eng/SKILL.md`](../../../.github/skills/emil-design-eng/SKILL.md).

---

## Privacy Hard Rule (Non-Negotiable)

> **NEVER copy child photos, personal health details, raw family text, or signed media URLs from `.data/frontend-verify/` (or production pages/fixtures) into tracked `docs/` files, commit messages, or skill examples.**
>
> `.data/frontend-verify/` is gitignored local verification output. All examples in `docs/design/references/` use synthetic placeholders (e.g., `[Child Name]`, `2026-01-15`, `1 岁 4 个月`) and CSS/layout structure only.

---

## The "Live Production + Feed Reference + Real Screenshot" Workflow

When designing or polishing a Nianlife V2 surface, avoid guessing aesthetics from memory, designing blindly against an empty local DB fallback, or over-animating generic templates. Run this loop:

### 0. Inspect Live Production UI First (Mandatory Before Any Design)
- **Always inspect the current live UI at `https://nianlife.cn` (or real populated screenshots) before proposing or implementing any visual/layout change.**
- Local dev without production DB records renders empty-material fallbacks (e.g., hiding populated Bento tiles and stretching remaining cards). Never mistake an empty local fallback for the real product layout, and always calibrate radii, spacing, and typography against the live populated state.

### 1. Feed Reference (Before Touching Code)
Pick the closest curated brief below and inspect external benchmarks for spatial rhythm, surface elevation, and motion restraint—never copying visual kits verbatim:
- **Product & Surface Benchmark**: **Amie.so** (daylight `#F3F5F9` canvas, `#FFFFFF` elevated cards, micro-pastel status pills), **Apple Journal** (warm editorial card spacing, calm media-first framing), **Retro.app** (chronological photo cards, low-chrome memory browsing).
- **External Pattern Libraries** (for structure & interaction ideas only; implement with Nianlife's scoped plain CSS in `v2/app/*.css` without adding external fonts or runtime animation libraries):
  - `recent.design` — consumer app polish, bento density, card hierarchy.
  - `reactbits.dev` — micro-interaction concepts (translate to CSS transitions + `transform`/`opacity`).
  - `motionsites.ai` — enter/exit pacing and scroll restraint.

### 2. Local Variant Iteration (`impeccable live` / `impeccable generate`)
For rapid visual exploration on a running local Next.js dev server (`v2/`):
1. Run `.github/skills/impeccable/scripts/impeccable.cmd context --target <route-or-css>` (or `impeccable live` / `impeccable generate`).
2. **Localhost only**: live browser injection runs strictly against local dev (`http://127.0.0.1:3000`); never weaken production CSP or inject into `https://nianlife.cn`.
3. Once a variant is accepted, move the chosen CSS rules into the route's real stylesheet (`v2/app/home.css`, `v2/app/memory/memory-modern.css`, etc.), remove temporary markers, and finish with `impeccable live-complete` + `impeccable live-server stop`.

### 3. Real Screenshot Verification (`.data/frontend-verify/`)
Verify layout, wrapping, contrast, and motion against real rendered pixels across both viewports in `.data/frontend-verify/` (existing Playwright harness: `node .data/frontend-verify/verify.mjs`):

| Viewport | Dimensions | Key Checks |
| --- | --- | --- |
| **Desktop** | `1440x900` (and `1280x900` legacy baseline) | Card grid rhythm, concentric corner alignment, header nav underline, hover lift restrained to `@media (hover: hover)` |
| **Mobile** | `390x844` (`deviceScaleFactor: 2`, `hasTouch: true`) | Zero horizontal overflow (`scrollWidth <= clientWidth`), Chinese heading/body wrapping, bottom dock clearance, `>= 44x44px` touch targets |

Capture **before** and **after** screenshots locally in `.data/frontend-verify/` for visual diffing, inspect animations at **10% playback speed** in DevTools Animations panel, and verify `prefers-reduced-motion: reduce`.

### 4. Dual Craft Audit (Before Commit)
Run a bounded polish check using both installed design-engineering skills:
1. **`make-interfaces-feel-better`** (`quick` <= 5 findings for targeted edits; `full` <= 15 findings for surface upgrades): concentric radius math, optical icon alignment, pure-black `1px` image outlines, `tabular-nums`, CJK `text-wrap`, and `>= 44px` hit areas.
2. **`emil-design-eng`**: frequency-first motion gate, *"What does motion help the user understand?"*, GPU-only `transform`/`opacity` transitions, custom `ease-out`/spring curves, and touch/reduced-motion gates.

---

## Reference Briefs in This Directory

| Brief | Covers | Primary Nianlife Files |
| --- | --- | --- |
| [`bento-and-cards.md`](bento-and-cards.md) | Modular Daylight Canvas surfaces, concentric radii, micro-pastel pills, shadows vs. borders, photo CLS & inset outlines | `v2/app/globals.css`, `v2/app/home.css`, `v2/app/memory/memory-modern.css`, `v2/app/mom-reports.css` |
| [`motion-and-feedback.md`](motion-and-feedback.md) | Frequency-first motion gate, GPU-only `transform`/`opacity`, spring/ease-out durations, `:active` press, origin-aware popovers, reduced-motion | `v2/app/globals.css`, `v2/app/home.css`, `v2/components/photo-viewer.tsx`, `v2/components/travel-atlas.tsx` |
| [`mobile-cjk-reading.md`](mobile-cjk-reading.md) | `390x844` Chinese typography, `text-wrap: balance`/`pretty`, Two Clocks `tabular-nums`, `>= 44px` hit areas, modal focus-trap & AA contrast | `v2/app/globals.css`, `v2/app/health/*`, `v2/app/travel/*`, `v2/app/mom-reports/*` |
