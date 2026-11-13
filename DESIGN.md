---
name: Nianlife V2 — Modular Daylight Canvas
description: A calm, daylight-first family life archive inspired by Amie, Apple Journal, and Retro.app — combining tactile white surfaces, micro-pastel semantic accents, concentric geometry, and CJK-optimized sans-serif typography.
colors:
  canvas-bg: "#F3F5F9"
  surface-white: "#FFFFFF"
  paper-dark: "#EAEFF6"
  card-soft: "#EEF2F8"
  ink-primary: "#0F172A"
  ink-secondary: "#334155"
  ink-muted: "#526075"
  cobalt-accent: "#2563EB"
  cobalt-ink: "#1D4ED8"
  tint-blue: "#EDF4FF"
  peach-accent: "#C2410C"
  peach-ink: "#9A3412"
  tint-peach: "#FFF4EE"
  lavender-accent: "#6D28D9"
  lavender-ink: "#5B21B6"
  tint-lavender: "#F4F0FF"
  mint-accent: "#047857"
  tint-mint: "#ECFDF5"
  danger-red: "#DC2626"
  health-rose: "#F43F5E"
  health-rose-soft: "#FDA4AF"
  health-rose-bridge: "#FFE4E6"
  health-urgent: "#BE123C"
  theater-slate: "#0B1120"
  theater-night: "#090D16"
  hairline-border: "rgba(15, 23, 42, 0.06)"
  hairline-strong: "rgba(15, 23, 42, 0.12)"
typography:
  display:
    fontFamily: "var(--font-poppins, 'Poppins'), -apple-system, 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "clamp(2.1rem, 5.5vw, 3.4rem)"
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "var(--font-poppins, 'Poppins'), -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "clamp(1.75rem, 4vw, 2.6rem)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.015em"
  title:
    fontFamily: "var(--font-poppins, 'Poppins'), -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "clamp(1.2rem, 2.6vw, 1.42rem)"
    fontWeight: 700
    lineHeight: 1.38
    letterSpacing: "-0.015em"
  body:
    fontFamily: "var(--font-nunito, 'Nunito'), -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.72
    letterSpacing: "0.008em"
  label:
    fontFamily: "var(--font-poppins, 'Poppins'), -apple-system, 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "0.85rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  media: "16px"
  xl: "18px"
  card: "24px"
  tile: "26px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  primary-button:
    backgroundColor: "{colors.ink-primary}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.lg}"
    padding: "0 20px"
    height: "44px"
  primary-button-hover:
    backgroundColor: "{colors.cobalt-accent}"
    textColor: "{colors.surface-white}"
  pill-badge:
    backgroundColor: "{colors.tint-blue}"
    textColor: "{colors.cobalt-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  surface-card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.card}"
    padding: "20px"
  media-frame:
    backgroundColor: "{colors.paper-dark}"
    rounded: "{rounded.media}"
  nav-dock:
    backgroundColor: "rgba(255, 255, 255, 0.88)"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "5px"
  nav-item-active:
    backgroundColor: "{colors.ink-primary}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.pill}"
    height: "44px"
---

# Design System: Nianlife V2 — Modular Daylight Canvas

> Authoritative design system for Nianlife V2 (implemented 2026-11-12 across `v2/app/globals.css`, `v2/app/home.css`, `v2/app/memory/memory-modern.css`, `v2/app/travel/travel.css`, `v2/app/health/health.css`, `v2/app/mom-reports.css`, and `v2/app/films/films.css`). Supersedes the 2026-09-05 Earth Tones specification in [docs/design/visual-system-v2.md](docs/design/visual-system-v2.md).

## Overview

**Creative North Star: "Modular Daylight Canvas"**

Nianlife V2 is a long-horizon digital life archive built for calm, multi-generational reading. Inspired by Amie.so, Apple Journal, and Retro.app, it pairs an airy cool-daylight canvas (`#F3F5F9`) with crisp elevated white cards (`#FFFFFF`), concentric corner geometry, and restrained micro-pastel tints. Rather than mimicking infant-oriented scrapbooks or heavy sepia journals, the visual system treats childhood records with the longevity and clarity of a modern personal publication—equally dignified on a grandparent's phone today and for Zhang Nian himself thirty years from now.

Every surface relies on self-hosted Latin webfonts (`Poppins` and `Nunito`) paired with native CJK system sans-serif stacks, zero external font requests (for reliable offline Docker builds and mainland China loading), GPU-composited micro-motion, and strict accessibility and layout-stability gates.

**Key Characteristics:**
- **Inspect live production first (`https://nianlife.cn`):** Always inspect the current live, data-populated UI state before designing or adjusting layout/radii/typography. Never design against an empty local DB fallback.
- **Daylight canvas + pure white cards:** Cool mist background (`#F3F5F9`) creates effortless figure-ground separation for `#FFFFFF` cards without heavy borders or dark outlines.
- **Micro-pastel semantic zoning:** Soft blue, peach, lavender, and mint washes categorize time, family voices, milestones, and follow-ups while keeping ink contrast strictly WCAG AA (`>= 4.5:1`).
- **Concentric corner geometry:** Outer card padding and inner media radii share an optical center (`innerRadius = max(12px, outerRadius - padding)` for cards/photos, adjusting padding rather than pinching photos below `12px`), preventing sharp or mismatched corners.
- **Self-hosted typography & CJK polish:** Local `Poppins` + `Nunito` Latin subsets paired with native CJK sans-serif (`PingFang SC`, `HarmonyOS Sans SC`, `MiSans`, `Microsoft YaHei UI`), tabular numerals for all dates/ages, and `text-wrap: balance`/`pretty`.
- **Restrained spring motion:** GPU-composited `transform` and `opacity` transitions (`cubic-bezier(0.22, 1, 0.36, 1)`) with graceful `prefers-reduced-motion` fallbacks.

## Colors

The palette anchors neutral daylight readability with deep slate ink, reserving saturated cobalt and micro-pastels for semantic orientation and active controls.

### Primary
- **Cobalt Accent** (`#2563EB` / `--brand-accent`, `--accent-blue`): Primary interactive highlight, hero focus cues, active links, and primary health action buttons.
- **Cobalt Ink** (`#1D4ED8` / `--clay-ink`, `--cobalt-ink`): Accessible text color on light blue pastel badges and links (`>= 4.5:1` on `#EDF4FF` and `#FFFFFF`).
- **Blue Micro-Pastel** (`#EDF4FF` / `--tint-blue`): Dual-clock date/age badges, active step indicators, and subtle secondary pill backgrounds.

### Secondary
- **Peach Accent / Ink** (`#C2410C` / `--accent-peach`, `#9A3412` / `--peach-ink`): Pre-birth (2024 pregnancy chapter) markers, milestone highlights, family voices metadata, and soft health recheck notices.
- **Peach Micro-Pastel** (`#FFF4EE` / `--tint-peach`): Warm container tint for family chat bubbles, prenatal chapters, and milestone callouts.
- **Lavender Accent / Ink** (`#6D28D9` / `--accent-lavender`, `#5B21B6` / `--lavender-ink`): Growth highlights on the home Bento mosaic, curated month highlights (`值得再读`), and medical attachment chips.
- **Lavender Micro-Pastel** (`#F4F0FF` / `--tint-lavender`): Container background for growth highlight tiles and reading aside notes.

### Tertiary
- **Mint Accent / Ink** (`#047857` / `--accent-mint`, `--sage-ink`, `--success`): Positive completion states, weekly summary badges, outside-food guides, and confirmed life facts.
- **Mint Micro-Pastel** (`#ECFDF5` / `--tint-mint`): Container tint for completed/confirmed indicators and health care summaries.

### Neutral
- **Daylight Canvas** (`#F3F5F9` / `--color-bg`): Global page canvas across all routes.
- **Elevated Surface** (`#FFFFFF` / `--color-surface`): Card, modal panel, and floating pill background.
- **Paper Dark / Soft Surface** (`#EAEFF6` / `--paper-dark`, `#EEF2F8` / `--card-soft`): Media loading placeholders, recessed legend panels, and inactive pill fills.
- **Deep Slate Ink** (`#0F172A` / `--color-primary`, `--color-text`): Primary headings, strong titles, active dark pill fills, and high-contrast body text.
- **Slate Secondary** (`#334155` / `--color-secondary`): Body prose, inactive navigation labels, and secondary metadata.
- **Slate Muted** (`#526075` / `--color-muted`): Captions, timestamps, age subtitles, and footer text.
- **Hairline Borders** (`rgba(15, 23, 42, 0.06)` / `--hairline`, `rgba(15, 23, 42, 0.08)` / `--color-border`, `rgba(15, 23, 42, 0.12)` / `--hairline-strong`): Whisper-thin structural separation.

### Scoped Module Palettes
- **Health Timeline (`.hp`):** Clinical clarity without alarm—verified active illness bands (`#F43F5E`), suspected spans (`#FDA4AF`), bridge intervals (`#FFE4E6`), no-data baseline (`#E2E8F0`), urgent flags (`#BE123C`), and full-screen attachment theater (`#0B1120` / `#0F172A`).
- **Theater & Lightbox Overlays:** Deep slate cinema backdrops (`#0B1120` in `.photo-viewer` and `.hp-view`; `#090D16` in `.memory-player`) isolate photography and video without pure-black harshness.
- **Mom Reports (`.mr-page`):** Preserves V1.3's five-tone content organizing palette (yellow `#f1b640`/`#fff6dc`/`#8a5a06`, green `#56b878`/`#edf9f1`/`#1f6e3f`, blue `#4f97ee`/`#eaf4ff`/`#2a5fa5`, coral `#ee897b`/`#fff0ed`/`#9f3a2d`, purple `#8b84e8`/`#f1efff`/`#5952b0`) atop the `#F3F5F9` canvas.
- **Travel Atlas (`.travel-page`):** Mist ocean backdrop (`#E6F2FA`) with radial sky/mint highlights and pastel city stamps.

### Named Rules
- **The WCAG AA Ink Rule.** Every ink token (`#0F172A`, `#334155`, `#526075`, `#1D4ED8`, `#C2410C`, `#6D28D9`, `#047857`) must maintain `>= 4.5:1` contrast against `#F3F5F9`, `#FFFFFF`, `#EAEFF6`, `#EEF2F8`, and its paired micro-pastel tint.
- **The Micro-Pastel Restraint Rule.** Tints (`--tint-blue`, `--tint-peach`, `--tint-lavender`, `--tint-mint`) categorize meaning; never stack competing bright fills inside the same card.

## Typography

**Display & Heading Font:** `var(--font-poppins, 'Poppins')` paired with native CJK system sans (`-apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif`).
**Body Font:** `var(--font-nunito, 'Nunito')` paired with the same native CJK system sans stack.
**Mono Font:** `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace`.

**Character:** Geometric Latin headings (`Poppins`) and rounded-clean prose (`Nunito`) harmonize with crisp Chinese system sans-serif glyphs. Self-hosted WOFF2 subsets live in `v2/app/fonts/poppins/` (weights 400, 500, 600, with 700 mapped to the 600 face to prevent synthetic faux-bold on numerals) and `v2/app/fonts/nunito/` (variable 400–800). Note: legacy `.serif` utility classes now resolve to `--font-heading` sans-serif across V2.

### Hierarchy
- **Display / Masthead** (`700`–`800`, `clamp(2.1rem, 5.5vw, 3.4rem)` / home `clamp(28px, 6.2vw, 40px)`, `line-height: 1.15–1.18`, `letter-spacing: -0.025em` to `-0.03em`): Hero greetings and page masthead titles; `text-wrap: balance`.
- **Headline / Section** (`700`–`800`, `clamp(1.75rem, 4vw, 2.6rem)`, `line-height: 1.18`, `letter-spacing: -0.015em`): Major section headers and year anchors.
- **Title / Card** (`700`–`800`, `clamp(1.2rem, 2.6vw, 1.42rem)` / card `18px–18.5px`, `line-height: 1.32–1.38`): Day entry headings, Bento tile titles, and month labels.
- **Body / Reading** (`400`–`500`, `1rem`–`1.08rem`, `line-height: 1.72` base / `1.82–1.92` long-form story reading, `letter-spacing: 0.008em`): Journal narratives, memory stories, and travel essays (`max-width: 36em–42em`, `text-wrap: pretty`).
- **Label / Time Signature** (`600`–`700`, `0.76rem–0.86rem`, `font-variant-numeric: lining-nums tabular-nums`): Dual-clock date/age pills, section marks, and calendar indices.

### Named Rules
- **The Zero-External-Fonts Rule.** Never import `next/font/google` or external CDN font stylesheets (`fonts.googleapis.com` requests must equal `0`); all Latin webfonts are self-hosted via `next/font/local` with `font-display: swap`.
- **The Tabular Clock Rule.** All dates, ages, calendar grid digits, and timeline markers use `font-variant-numeric: tabular-nums` (or `lining-nums tabular-nums`) so numbers never jitter or misalign.
- **The CJK Wrapping Rule.** Headings use `text-wrap: balance` (or `text-wrap: pretty` on long Chinese event titles) to avoid orphan 1-character lines on `390px` viewports; keep short date/age pills single-line with `white-space: nowrap` where space permits.

## Layout

Nianlife V2 uses centered, content-appropriate container widths with generous breathing room and mobile-first safe-area support (`viewport-fit: cover`).

- **Container Widths:**
  - Wide shell / Header / Footer: `min(1360px, calc(100% - 32px))` on mobile, `calc(100% - 64px)` at `>= 700px`/`768px`.
  - Home Canvas: `min(1340px, 100%)` with `20px 16px 64px` mobile padding, `28px 24px 76px` at `>= 680px`, and `34px 28px 88px` at `>= 900px`.
  - Photo & Health Container: `min(1200px, calc(100% - 32px))` (`.photo-wrap`, `.hp`).
  - Memory Directory & Desktop Calendar Shell: `min(1040px, ...)` on `/memory`, expanding to `min(1140px, ...)` when the sticky `356px` left calendar rail is active (`>= 960px`).
  - Reading Column: `min(820px, ...)` on month/detail pages (`min(780px, ...)` base `.reading-wrap`); `860px` on Mom Reports (`.mr-app`).
- **Home 12-Column Bento Mosaic (`>= 900px`):** `grid-template-columns: repeat(12, minmax(0, 1fr))` with `18px` gap—lead photo tile spans columns `1 / 6` across rows `1 / 3`, paired on the right with Latest Day (`6 / 10`), Growth (`10 / 13`), Family Voices (`6 / 10`), and Film (`10 / 13`), collapsing gracefully to 2 columns at `680px` and 1 column on mobile.
- **Breakpoints:** `560px` (compact mobile calendar/nav), `640px`/`680px` (2-col grids & tablet Bento), `700px`/`720px` (reading wrap expansion & split layouts), `768px` (desktop segmented header nav replaces mobile bottom dock), `900px`/`960px` (12-col Bento & desktop sticky calendar rail), `1180px` (expanded Bento latest-day photo).
- **Safe-Area & Overflow Guard:** `body` uses `min-height: 100dvh` and `overflow-x: clip` (preserving sticky headers without horizontal scroll on `375px–390px` viewports); fixed docks respect `env(safe-area-inset-bottom)`.

### Named Rules
- **The URL-Persisted State Gate.** Route-level views, active tabs, month/year filters, and date targets must be reflected in URL query parameters, path segments, or history state (e.g., `/mom-reports?month=`, `/memory#day-`, `history.pushState` for full-screen overlays) so reloads, shared links, and browser Back navigation restore context reliably.
- **The Media Aspect-Ratio CLS Gate.** Every image and video container must declare explicit `width`/`height` attributes or CSS `aspect-ratio` (e.g., `4 / 5`, `4 / 3`, `1 / 1`, `9 / 16`, or inline `--media-ar` from `aspectRatioOf(media)`) so zero layout shift occurs while media loads.

## Elevation & Depth

Depth is conveyed through subtle multi-layer ambient shadows, 1px hairline borders, and frosted-glass (`backdrop-filter`) navigation overlays—never heavy drop shadows or stacked dark outlines.

### Shadow Vocabulary
- **Ambient Card (`--shadow`):** `0 1px 2px rgba(15, 23, 42, 0.03), 0 8px 24px -4px rgba(15, 23, 42, 0.05)` (home Bento variant `--card-shadow`: `0 1px 2px rgba(15, 23, 42, 0.03), 0 10px 28px -6px rgba(15, 23, 42, 0.05)`).
- **Lifted Hover (`--shadow-hover`):** `0 2px 6px rgba(15, 23, 42, 0.05), 0 16px 36px -6px rgba(15, 23, 42, 0.09)` (home Bento variant `--card-shadow-hover`: `0 4px 12px rgba(15, 23, 42, 0.05), 0 20px 38px -10px rgba(15, 23, 42, 0.10)`).
- **Badge / Pill (`--shadow-badge`):** `0 1px 3px rgba(15, 23, 42, 0.04)`.
- **Frosted Glass Chrome:** Sticky header (`rgba(243, 245, 249, 0.84)` + `blur(18px) saturate(150%)`), desktop/mobile floating docks (`rgba(255, 255, 255, 0.88)` + `blur(20px) saturate(160%)`), and sticky month/health switchers (`blur(14px–16px) saturate(140%)`).

### Motion Tiers & GPU Compositing
- **Timing Curves:** `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)` for responsive UI springs, card lifts, and entrance animations (`rise`, `fadeInUp`); `--ease-out: cubic-bezier(0.25, 1, 0.5, 1)` for gentle opacity fades.
- **Tier 1 — Micro-Interaction (180ms–260ms):** Button/pill press (`scale(0.95–0.985)`), hover lift (`translateY(-1px to -4px)`), color/border shifts.
- **Tier 2 — Card & Image Reveal (320ms–520ms):** Card elevation hover, image zoom (`scale(1.02–1.045)`), scroll-triggered `.reveal` / `.io-reveal-pending` (`rise` / `fadeInUp`).
- **Tier 3 — Ambient & Theater (720ms–900ms+):** Cross-fades in `HomeMemory` / `MemoryPlayer`, slow Ken Burns pan/zoom (`memory-ken-0..3`), and ambient SVG drift on `.travel-page`.

### Named Rules
- **The GPU-Composited Animation Rule.** Animate only compositor-friendly properties (`transform`, `opacity`, and `filter`/`box-shadow` sparingly on non-scrolling cards). Never animate layout properties (`width`, `height`, `padding`, `margin`, `top`, `left`); replace layout shifts (such as underline expansion) with `transform: scaleX(...)` or `translate(...)`.
- **The Graceful Reduced-Motion Gate.** Under `@media (prefers-reduced-motion: reduce)`, disable spatial transforms, Ken Burns motion, bounces, and smooth scrolling (`scroll-behavior: auto`), while preserving immediate visibility (`opacity: 1`) and subtle non-spatial state feedback (color/border/opacity cues) rather than breaking interactive states. Note: Legacy global `0.01ms !important` wildcards in `globals.css` / `memory-modern.css` are being refined toward targeted spatial suppression so subtle state cues remain legible.

## Shapes

Every container, media frame, and pill follows continuous rounded geometry anchored by a strict concentric radius formula.

- **Radius Scale:**
  - `--radius-sm: 6px` (PhotoGrid sub-cells, focus outlines, small checkboxes)
  - `--radius-md: 10px` (base buttons, tags, inline warning pills)
  - `--radius-lg: 14px` (primary buttons, form inputs, travel postcard inner photos, calendar cells)
  - `--r-media: 16px` (embedded media frames, inline story grids, recessed detail panels)
  - `--radius-xl: 18px` (day hero frame, memory player slots, footprint cards)
  - `--r-card: 24px` (standard content cards, health cards, film frame, modal sheets; home Bento tiles `26px`)
  - `--r-badge: 999px` (all navigation docks, pills, date/age badges, circular icon buttons)

### Named Rules
- **The Concentric Radius Rule.** Whenever a rounded element sits inside a rounded container with padding, derive the inner radius from the outer radius minus the padding: `innerRadius = max(0, outerRadius - padding)` (with a minimum `6px` floor for small nested media). Verified examples in code:
  - `.month-card` (`24px` outer) + `10px` padding -> `.month-card-photo` (`16px` inner, `--r-media`).
  - `.travel-postcard` (`24px` outer) + `12px` padding -> `.travel-postcard-photo` (`14px` inner).
  - `.travel-postcard-scenery` (`10px` outer) + `4px` padding -> inner crop (`6px`).
  - `.site-header` `.brand` (`14px` outer) + `4px` padding -> `.brand-mark` (`11px`).
  - `.film-home` (`999px` pill) + `4px` padding -> `.film-home-mark` (`50%` circle).

## Components

### Navigation (`.site-header`, `.desktop-nav`, `.bottom-nav`)
Sticky frosted-glass top bar (`min-height: 62px` mobile / `72px` desktop) pairing the cobalt gradient `"年"` brand mark (`36×36px`, `11px` radius) and title with a centered floating pill dock (`.desktop-nav`) on `>= 768px` and a fixed frosted bottom dock (`.bottom-nav`, `max-width: 400px`) on mobile, plus a `44×44px` circular search button (`/memory/search`). Equal-weight primary destinations: `首页`, `记忆`, `健康` (feature-flagged), `旅行`, `妈妈月报`.

### Bento Tiles & Journal Cards (`.bento-tile`, `.j-card`, `.month-card`)
White `#FFFFFF` cards (`--r-card: 24px`, `1px solid var(--hairline)`, `--shadow`) with micro-pastel header/tag accents (`--tint-blue`, `--tint-lavender`, `--tint-peach`, `--tint-mint`). Cards with hover states lift `-3px` to `-4px` on pointer devices (`@media (hover: hover)`) and compress subtly (`scale(0.985–0.992)`) on `:active`.

### Photo Grids & Media Frames (`.pg`, `.day-hero-frame`, `.film-video`)
Concentric `16px` outer `.pg` grid with `6px` gap and `6px` sub-cells (`.pg-1` through `.pg-mosaic`), matching `object-fit: cover` with portrait-safe `object-position: 50% 20%–35%` to avoid head cropping. Final hidden-count cell (`.pg-more`) uses frosted glass (`blur(8px)`) and never displays raw photo counts in the primary reading layer.

### Modals, Lightboxes & Drawers (`.photo-viewer`, `.day-album-sheet`, `.memory-player`, `.hp-view`)
Full-screen overlays portal to `document.body` (escaping transformed ancestors) on dark slate backdrops (`#0B1120` / `#090D16`), supporting pinch/button zoom, swipe reels, and safe-area padded headers/controls.

### Named Rules
- **The Strict Modal Accessibility Gate.** Every modal/lightbox/sheet must:
  1. Render via native `<dialog>.showModal()` or explicitly set `inert` on all sibling children of `document.body` (`DayAlbumSheet`, `MemoryPlayer`).
  2. Trap keyboard focus inside the modal and move initial focus into the sheet/close control on open.
  3. Close cleanly on `Escape`, backdrop/close button click, and mobile browser back gesture (`history.pushState` + `popstate`).
  4. Restore focus to the exact triggering element (`returnFocusTo.current?.focus({ preventScroll: true })`) *after* `inert` / modal state is torn down.
- **The 44px Touch Target Gate.** Every interactive link, button, pill, summary disclosure, checkbox label, and timeline hit area must measure at least `44×44px` (either directly via `min-width: 44px; min-height: 44px` or via expanded `::before` pseudo-element hit zones as in `.hp-bp::before`, `.hp-nd::before`, `.hp-rt::before`).

## Do's and Don'ts

### Do:
- **Do** preserve `innerRadius = max(0, outerRadius - padding)` whenever nesting media, sub-cards, or pills inside padded containers.
- **Do** define explicit `aspect-ratio` or `width`/`height` on every media slot (`aspectRatioOf`, `.pg-cell`, `.day-hero-img`) to maintain zero CLS.
- **Do** persist active tabs, month/year selections, and overlay states in URL search params, hash anchors, or `history.state` so navigation and refresh preserve context.
- **Do** enforce `>= 44px` touch targets on all mobile and desktop interactive controls, including inline prose links and icon buttons.
- **Do** animate only GPU-composited `transform` and `opacity` properties, and honor `@media (prefers-reduced-motion: reduce)` with calm, legible non-spatial state feedback.
- **Do** verify every foreground/background pairing against WCAG AA (`>= 4.5:1`) using the existing slate ink and ink-safe micro-pastel tokens (`#1D4ED8`, `#9A3412`, `#5B21B6`, `#047857`).

### Don't:
- **Don't** import Google Fonts (`fonts.googleapis.com`) or external CSS/icon CDNs; use only self-hosted fonts (`v2/app/fonts/`) and inline SVGs.
- **Don't** bring back Earth Tones (`#F9F6F0` / `#433E38` / `#9EAB92`), classical serif headings, cartoonish baby-app visuals, or raw unrounded 90-degree corners on cards/media.
- **Don't** animate layout properties (`width`, `height`, `padding`, `margin`) for hover/active indicators.
- **Don't** create modals without `Escape` handling, `inert`/native `<dialog>` focus containment, `popstate` back-button support, and post-close focus return.
- **Don't** apply heavy `box-shadow` or individual scroll animations to dense thumbnail grids inside collapsed month archives.
