# Mobile & CJK Reading Reference (`390x844` & `1440x900`)

> **Benchmark Feel**: Effortless Chinese/bilingual reading for parents and grandparents on phones (`390x844`) and desktops (`1440x900`) without horizontal wobble, tiny tap targets, or low-contrast metadata.  
> **Primary Skills**: `make-interfaces-feel-better` (Typography, Surfaces), `impeccable` (typeset, adapt, harden).

---

## 1. Self-Hosted Font Stack & Rendering

Per `AGENTS.md`, Nianlife readers are primarily in mainland China—**never load Google Fonts or external font CDNs**. Use the self-hosted Poppins/Nunito + native CJK sans stack defined in `v2/app/globals.css`:

```css
--font-sans: var(--font-poppins, 'Poppins'), -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif;
--font-body: var(--font-nunito, 'Nunito'), -apple-system, BlinkMacSystemFont, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif;
```

- **Smoothing**: Apply `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;` once on `body`/`html` (never per-component).
- **Line Height & Measure**: Chinese editorial prose reads comfortably at `1.65–1.78` `line-height`, `letter-spacing: 0.008em`, and readable paragraph width (`max-width: 38em–44em`).

---

## 2. CJK Line-Wrapping & Tabular Two Clocks

- **Headings (`h1`–`h4`)**: Apply `text-wrap: balance` on short headings (`<= 6` lines) so multi-line Chinese titles split symmetrically instead of leaving a lone 2-character tail.
- **Body Copy, Quotes & Captions (`p`, `figcaption`, `blockquote`)**: Apply `text-wrap: pretty` to prevent single-character or punctuation orphans on the final line; leave long 10+ line essays with default wrapping.
- **Two Clocks & Measurements (`tabular-nums`)**: Apply `font-variant-numeric: lining-nums tabular-nums` on `<time>`, age badges (`1 岁 7 个月`), health chart values, and mom-report metrics so digits align cleanly and never jitter when switching days/months.
- **Safe Non-Breaking Chips (`.keep-whole`)**:
  - Use `white-space: nowrap` only on short atomic tokens (`1 岁 7 个月`, `2026.01.15`), inside `display: flex; flex-wrap: wrap` containers.
  - Never put `white-space: nowrap` on long multi-word titles, place lists, or un-wrapped containers at `390px`—test `document.documentElement.scrollWidth <= window.innerWidth`.
- **200% Text-Size Resilience**: Metric cards (`.mr-page`, `.hp`) must allow value + unit labels to wrap (`flex-wrap: wrap`) instead of clipping or overlapping when system font scale is raised to 200%.

---

## 3. Touch Targets, URL State & Modal Accessibility

- **Minimum `44x44px` Touch Targets**:
  - Every button, pill tab, header nav link, photo-viewer zoom/close control, and calendar cell on mobile (`390x844`) must have at least a `44x44px` hit area (`min-height: 44px; min-width: 44px`, or a centered `::after` pseudo-element).
  - Never allow adjacent hit areas to overlap (`gap >= 4px–8px` between compact pills).
- **URL-Persisted State**: Tabs, year/month selectors, atlas regions, and filter states should reflect in URL query/path state where shareable so Back/Refresh preserves the reader's exact place.
- **Strict Modal & Viewer Focus Containment**:
  - `PhotoViewer` and health attachment modals must trap `Tab`/`Shift+Tab` inside the dialog, close on `Escape`, announce state changes cleanly to screen readers (`aria-live` / `role="dialog"` + `aria-modal="true"`), and restore focus to the triggering element on close.
- **Single `<main>` Landmark**: Route pages rendered inside the shared app shell must never nest a second `<main>` element inside the layout's `<main>`.

---

## 4. WCAG AA Contrast Floor

All readable ink on `#F3F5F9` canvas, `#FFFFFF` cards, and micro-pastel tints (`#EDF4FF`, `#FFF4EE`, `#F4F0FF`, `#ECFDF5`) must meet **>= 4.5:1** contrast for normal/small text (`--color-primary: #0F172A`, `--color-secondary: #334155`, `--color-muted: #526075`) and **>= 3:1** for large display headings and UI graphics.

---

## Inspection Checklist (`390x844` + `1440x900`)

- [ ] `scrollWidth <= clientWidth` at `390x844` and `375x812` with zero clipped pills or horizontal scrollbars.
- [ ] Headings use `text-wrap: balance`; short Chinese paragraphs/quotes use `text-wrap: pretty`.
- [ ] All Two Clocks dates, ages, and health numbers use `tabular-nums`.
- [ ] Every mobile tap target is `>= 44x44px` with non-overlapping hit boxes.
- [ ] Small muted labels and tinted badges pass `>= 4.5:1` contrast (checked on `#FFFFFF`, `#F3F5F9`, and pastel tints).
- [ ] Modals/viewers enforce `Tab` trap, `Esc` close, and return focus; page has exactly one `<main>`.
