# Motion & Feedback Reference

> **Benchmark Feel**: Calm, crisp, unhurried response—software that listens immediately without calling attention to itself.  
> **Primary Skills**: `emil-design-eng`, `make-interfaces-feel-better` (Animations, Performance).

---

## 1. Frequency-First Motion Gate

Before writing any transition or keyframe, classify how often a family member triggers it:

| Frequency | Nianlife Examples | Policy |
| --- | --- | --- |
| **100+ / day or Keyboard-driven** | Esc closing `PhotoViewer`, `ArrowLeft`/`ArrowRight` in `TravelAtlas` or photo gallery, `+`/`-`/`0` zoom shortcuts | **0ms / No entrance animation**. Keyboard actions must feel instantaneous. |
| **Tens / day** | Top nav links, year/month pills, filter chips, list row hover | **Instant or `<= 150ms` subtle opacity/color/underline**. No bounce, no stagger. |
| **Occasional** | Opening `PhotoViewer`, health attachment modal, collapsible detail drawers | **`150–250ms` crisp ease-out** (`< 300ms` ceiling). |
| **Rare / First-time** | Empty-state reveal, milestone highlight | Gentle `transform` + `opacity` allowed; never block clicks/scroll. |

Every animation must answer: **"What does motion help the user understand?"** (spatial continuity, state confirmation, tactile press, or avoiding a jarring cut).

---

## 2. GPU-Only Compositing Rules

- **Animate ONLY `transform` and `opacity`** (plus lightweight `clip-path` or `filter: blur(2px)` crossfades where justified).
- **Forbidden Transition Properties**:
  - `transition: all` — forces property watching and triggers accidental layout transitions.
  - `width`, `height`, `padding`, `margin`, `top`, `left` — trigger main-thread layout + paint on every frame.
- **Concrete Replacements in Nianlife CSS**:
  - *Nav link active underline*: animate `transform: scaleX(0)` -> `scaleX(1)` on `::after` (`transform-origin: center`) instead of `width: 0 -> 100%`.
  - *Active pill / card lift*: animate `transform: translateY(-2px)` and `opacity` instead of shifting `margin` or `padding`.
- **Interruptibility**: Use CSS `transition` (not `@keyframes`) on interactive open/close/toggle states so rapid re-clicks smoothly retarget mid-flight instead of snapping back to frame 0.
- **Do not animate inherited CSS vars on containers** during scroll/drag; mutate `transform` directly on the moving element.

---

## 3. Easing, Timing & Component Mechanics

```css
/* Standard Nianlife tokens (v2/app/globals.css) */
--ease-spring: cubic-bezier(0.22, 1, 0.36, 1);
--ease-out: cubic-bezier(0.25, 1, 0.5, 1);
```

- **Never use `ease-in`** on UI entrances/exits—its slow start makes clicks feel sluggish.
- **Durations**:
  - Button / pill `:active` press: `120–160ms` `var(--ease-out)` with `transform: scale(0.97)` (range `0.96–0.97`, never `< 0.95`).
  - Tooltips & small popovers: `125–180ms`.
  - Dropdowns, segmented tabs & modals: `150–250ms` enter, `150–200ms` exit (exits are always faster and softer than enters, e.g., `translateY(-8px)` or `scale(0.97)` + `opacity: 0`).
- **No `scale(0)` Entrances**: Start entrances from `scale(0.95)` + `opacity: 0` (or `@starting-style` where supported).
- **Origin Awareness**: Popovers and anchored menus scale from their trigger (`transform-origin` toward trigger); viewport-centered modals (`PhotoViewer`, health detail dialog) keep `transform-origin: center`.
- **Tooltip Delay Pattern**: Use an initial hover delay (`300–500ms`) on the first hovered control, then skip delay & animation (`0ms`) when moving directly to an adjacent tooltip while one is already open.

---

## 4. Touch Guard & `prefers-reduced-motion`

- **Prevent Sticky Mobile Hover**: Wrap spatial hover lifts (`translateY`, `scale`) inside:
  ```css
  @media (hover: hover) and (pointer: fine) {
    .interactive-card:hover { transform: translateY(-2px); }
  }
  ```
- **Respect `prefers-reduced-motion: reduce`**:
  - Remove spatial movement (`transform`, `translate`, `scale`, stagger delays, smooth-scroll jumps).
  - **Keep subtle `150ms ease` opacity and color transitions** so focus rings, active tab states, and modal overlays remain intelligible rather than vanishing in `0.01ms`.

---

## Inspection Checklist

- [ ] Zero `transition: all` and zero `width` / `height` / `padding` / `margin` transitions in modified CSS.
- [ ] Keyboard shortcuts (`Esc`, `Arrows`, `+`/`-`/`0`) respond with zero entrance delay.
- [ ] Modals/popovers enter from `scale(0.95)` + `opacity: 0` (never `scale(0)`), with exits faster than enters.
- [ ] Hover transforms are gated behind `@media (hover: hover) and (pointer: fine)`.
- [ ] Checked at 10% speed in DevTools Animations panel and verified under `prefers-reduced-motion: reduce`.
