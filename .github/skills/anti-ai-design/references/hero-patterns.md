# Hero Patterns

LLM-optimized hero section reference for `anti-ai-design`. Load this file during Phase 3 when generating a landing page, hero section, or primary above-the-fold screen. Each archetype provides structural DNA, content hierarchy, responsive collapse, motion, and a concrete LLM prompt snippet.

## How to Use This Reference

- Load this file ONLY when the screen is a landing page or primary above-fold hero.
- Pick ONE archetype that matches the product type and chosen design style.
- Cross-reference the chosen style's "Hero archetypes" section in `design-styles-catalog.md` for visual flavor (fonts, colors, materiality). This file provides structural patterns; the styles catalog provides aesthetic specifics.
- Apply the Hero-Specific Anti-Patterns below on EVERY hero generation.
- Use the LLM Prompt Snippet as a concrete rendering baseline, then layer the style's aesthetic on top.

## Hero-Specific Global Anti-Patterns

These supplement the global BANNED PATTERNS in SKILL.md. All apply to every hero:

1. NO hero taller than `100dvh` without visible scroll affordance — content below must be hinted
2. NO hero with more than 2 CTAs (one primary + one ghost/text maximum)
3. NO hero where headline and subhead use the same font-weight
4. NO hero with auto-playing video without a static poster frame fallback
5. NO hero where mobile collapse simply shrinks the desktop version — must redesign layout for single-column
6. NO hero without a clear scroll-down affordance when content exists below fold
7. NO hero that relies solely on a background image with no contrast overlay or text shadow
8. NO hero where the primary CTA falls below the fold on mobile (must be visible within 100dvh)

## Archetype Index

| # | Archetype | Layout | Best For | Motion | Media |
|---|-----------|--------|----------|--------|-------|
| 1 | Full-Width Text | single-col centered or left | SaaS, Minimal, Docs | FADE_UP | none |
| 2 | Split Asymmetric | 60/40 or 55/45 grid | Product, Startup, App | FADE_UP | image/mockup right |
| 3 | Full-Bleed Image | image fills viewport, text overlaid | Luxury, Creative, Editorial | CLIP_REVEAL | full-bleed bg image |
| 4 | Centered Cinematic | centered, dramatic vertical spacing | Film, AI, Crypto, Dark UI | CLIP_REVEAL | optional dark media |
| 5 | Bento Hero | bento grid cells | Dashboard, Analytics, Fintech | SCALE_IN | metric cards |
| 6 | Product Screenshot | product image as centerpiece | App Launch, SaaS, Dev Tools | SPRING_SOFT | product screenshot |
| 7 | Scroll-Trigger Reveal | hidden until scroll, parallax | Portfolio, Agency, Creative | CLIP_REVEAL | layered parallax |
| 8 | Dashboard Metric | KPI stats hero, no traditional headline | Fintech, Analytics, Admin | SCALE_IN | sparklines/charts |
| 9 | Text-Only Masthead | pure typography, decorative rules | Editorial, Magazine, Blog | FADE_UP | none |
| 10 | Stacked Cards | layered cards behind headline | Premium SaaS, Fintech | SPRING_SOFT | card stack |
| 11 | Gradient Mesh | Apple-style aurora/mesh bg | Premium, AI, Music, Crypto | SCALE_IN | gradient |
| 12 | Video Ambient | background video with overlay | Entertainment, Brand, Lifestyle | CLIP_REVEAL | video/animation |
| 13 | Illustration-Led | custom SVG as visual anchor | Education, Kids, Startup, Health | SPRING_BOUNCY | illustration |

---

## 1. Full-Width Text Hero

**ID:** `full-width-text`
**When to use:** SaaS landing pages, minimal products, documentation sites, developer tools
**Avoid for:** Luxury, entertainment, portfolio (needs visual weight)

**Content Hierarchy:**
- Headline: 48–72px, weight 600–700, tight tracking (-0.02em to -0.04em), max 8 words
- Subhead: 18–22px, weight 400, max 120 characters, muted color (50-60% opacity of heading)
- CTA: single pill or filled button, weight 500-600, 14-16px
- Supporting: optional trust logos below CTA at 40% opacity

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="min-h-[80dvh] flex items-center">
  <div class="max-w-3xl mx-auto px-6 py-24 space-y-6">
    <h1>...</h1>
    <p class="subhead">...</p>
    <div class="cta-group">...</div>
  </div>
</section>
```

**CSS Pattern:** `text-left max-w-3xl space-y-6` · heading: `text-5xl md:text-6xl font-bold tracking-tight` · sub: `text-lg md:text-xl text-[color]/60 max-w-xl`

**Responsive Collapse:**
- Desktop: full-width text, generous vertical padding (py-24 to py-32)
- Tablet: same structure, reduce heading to text-4xl
- Mobile: text-3xl heading, py-16, CTA full-width

**Motion:** FADE_UP — heading enters first (opacity 0→1, translateY 20px→0, 400ms), subhead 80ms later, CTA 160ms later. Easing: cubic-bezier(0.16, 1, 0.3, 1).

**Anti-Patterns:**
- Centering text without purpose (left-align by default for readability)
- Using body font weight for headline
- Adding decorative background gradients that distract from typography

**LLM Prompt Snippet:** "White/light bg. Headline 56px [heading font] weight 700 tracking -1.5px [primary color]. Subtitle 20px weight 400 [secondary color] max 60 chars on single line. One dark filled CTA: 16px weight 600, 12px 24px padding, [radius] corners. No images, no illustrations. 120px top padding, 80px bottom. Fade-up entrance on scroll."

---

## 2. Split Asymmetric Hero

**ID:** `split-asymmetric`
**When to use:** Product launches, startup landing pages, app introductions, feature showcases
**Avoid for:** Data-heavy dashboards, editorial, text-only brands

**Content Hierarchy:**
- Left (60%): headline 40–60px weight 600–700 + subhead 16–20px + CTA group
- Right (40%): product image/mockup/illustration, vertically centered
- Optional: badge or label above headline (12px uppercase tracking-widest)

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="min-h-[85dvh] grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] items-center gap-12">
  <div data-ai-id="hero-content" class="space-y-6 px-6 lg:pl-16">
    <span class="badge">...</span>
    <h1>...</h1>
    <p>...</p>
    <div class="cta-group flex gap-3">...</div>
  </div>
  <div data-ai-id="hero-media" class="relative">
    <img ... />
  </div>
</section>
```

**CSS Pattern:** `grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] items-center gap-12 lg:gap-16` · left: `space-y-6` · right: `relative overflow-hidden rounded-xl`

**Responsive Collapse:**
- Desktop: side-by-side 60/40 grid
- Tablet: stack with image below text, image at 80% width centered
- Mobile: full-width stack, image hidden or shrunk to 60% as accent

**Motion:** FADE_UP — text side fades up (300ms). Media side scales from 0.95→1.0 + opacity (400ms, 150ms delay). Easing: cubic-bezier(0.16, 1, 0.3, 1).

**Anti-Patterns:**
- Perfect 50/50 split (creates visual stalemate)
- Image smaller than text column (undermines purpose)
- Stacking at tablet without rebalancing visual weight

**LLM Prompt Snippet:** "Grid: left 58% text, right 42% media. Left: badge 12px uppercase [accent color], headline 48px [heading font] weight 700 tracking -1.2px, subtitle 18px weight 400 [secondary color], two CTAs (filled primary + ghost secondary). Right: product screenshot with 12px radius, subtle shadow (0 20px 50px rgba(0,0,0,0.08)). 16px gap between columns. Items vertically centered."

---

## 3. Full-Bleed Image Hero

**ID:** `full-bleed-image`
**When to use:** Luxury brands, creative agencies, editorial magazines, photography portfolios
**Avoid for:** SaaS dashboards, developer tools, data-heavy products

**Content Hierarchy:**
- Background: full-viewport image with 40-60% dark overlay
- Headline: 48–80px serif or display font, weight 600–700, light/white color, positioned at 70-90% height
- Subhead: 16–20px, light/white at 80% opacity, max 100 chars
- CTA: ghost button (border-only, light) or subtle filled button

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="relative min-h-[100dvh] flex items-end">
  <div class="absolute inset-0 bg-cover bg-center" style="background-image:url(...)">
    <div class="absolute inset-0 bg-black/50"></div>
  </div>
  <div data-ai-id="hero-content" class="relative z-10 p-8 lg:p-16 pb-16 lg:pb-24 max-w-2xl">
    <h1>...</h1>
    <p>...</p>
    <a class="cta">...</a>
  </div>
</section>
```

**CSS Pattern:** `relative min-h-[100dvh] flex items-end` · overlay: `absolute inset-0 bg-black/50` · content: `relative z-10 p-8 lg:p-16 pb-24 max-w-2xl text-white`

**Responsive Collapse:**
- Desktop: content positioned bottom-left with generous padding
- Tablet: same position, reduce heading size
- Mobile: content centered at bottom, heading text-3xl, full-width CTA

**Motion:** CLIP_REVEAL — image reveals via clip-path inset(100% 0 0 0)→inset(0) over 700ms. Text fades up 200ms after image settles. Easing: cubic-bezier(0.16, 1, 0.3, 1).

**Anti-Patterns:**
- Overlay lighter than 35% (text unreadable)
- Centering all text over a busy image without contained background
- Using sans-serif body font as headline on editorial images
- Navigation floating inside the hero without differentiation

**LLM Prompt Snippet:** "Full-viewport image hero. BG: high-quality image bg-cover bg-center. Overlay: bg-black/50. Content at bottom-left: headline 64px [display serif] weight 600 text-white tracking -2px, subtitle 18px text-white/80, ghost CTA (border border-white/40 text-white px-6 py-3 hover:bg-white/10). Clip-path reveal animation on image. 24px bottom padding."

---

## 4. Centered Cinematic Hero

**ID:** `centered-cinematic`
**When to use:** Film/video products, AI platforms, crypto, dark-mode-first brands, premium launches
**Avoid for:** E-commerce, kids products, healthcare, education

**Content Hierarchy:**
- Dark background (near-black or deep brand color)
- Headline: 56–96px, centered, tight line-height (1.0–1.1), weight 500–700, white or light
- Subhead: 16–20px, centered, 60% opacity white, max 80 chars
- CTA: centered, single glowing or filled button with subtle glow effect
- Optional: ambient particles, grain texture, or gradient accent

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="relative min-h-[100dvh] flex items-center justify-center bg-gray-950 text-white overflow-hidden">
  <div class="absolute inset-0 pointer-events-none">[ambient effect]</div>
  <div data-ai-id="hero-content" class="relative z-10 text-center max-w-3xl px-6 space-y-8">
    <h1>...</h1>
    <p>...</p>
    <div class="cta-group">...</div>
  </div>
</section>
```

**CSS Pattern:** `min-h-[100dvh] flex items-center justify-center bg-gray-950 text-white` · heading: `text-6xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-none text-center` · CTA: glow via `shadow-[0_0_20px_rgba(accent,0.4)]`

**Responsive Collapse:**
- Desktop: massive heading (text-8xl), 100dvh, dramatic spacing
- Tablet: text-6xl, maintain centering
- Mobile: text-4xl, py-20 instead of full viewport if content below

**Motion:** CLIP_REVEAL — headline characters stagger in (30ms per char, opacity 0→1). Background ambient effect loops. CTA pulses glow subtly. Easing: cubic-bezier(0.16, 1, 0.3, 1).

**Anti-Patterns:**
- Generic starfield or floating orbs (banned by anti-AI rules)
- Headline under 48px (undermines cinematic impact)
- Light background (defeats cinematic mood)
- More than one CTA

**LLM Prompt Snippet:** "True black bg (#050505). Centered layout. Headline 80px [geometric sans] weight 600 text-white tracking -3px line-height 0.95. Subtitle 18px text-white/50 max 70 chars. Single CTA: [accent color] bg, white text, 14px weight 600, shadow-[0_0_24px_rgba(accent,0.35)]. Subtle radial gradient at center (accent color 5% opacity, 400px radius). Character-stagger entrance."

---

## 5. Bento Hero

**ID:** `bento-hero`
**When to use:** Dashboards, analytics platforms, fintech products, multi-feature showcases
**Avoid for:** Minimalist brands, editorial, luxury, single-product launches

**Content Hierarchy:**
- Lead cell (spans 2 cols): headline 32–48px + subhead + CTA
- Supporting cells: metric cards, feature previews, mini-charts
- Each cell: independent content with own surface treatment
- No traditional hero structure — the grid IS the hero

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="min-h-[85dvh] grid grid-cols-2 lg:grid-cols-4 grid-rows-[auto] gap-3 p-4 lg:p-8">
  <div data-ai-id="hero-lead" class="col-span-2 row-span-2 rounded-2xl p-8 flex flex-col justify-end">
    <h1>...</h1>
    <p>...</p>
    <a class="cta">...</a>
  </div>
  <div data-ai-id="hero-cell-1" class="rounded-xl p-5">...</div>
  <div data-ai-id="hero-cell-2" class="rounded-xl p-5">...</div>
  <div data-ai-id="hero-cell-3" class="col-span-2 rounded-xl p-5">...</div>
</section>
```

**CSS Pattern:** `grid grid-cols-2 lg:grid-cols-4 gap-3 p-4` · lead cell: `col-span-2 row-span-2 bg-[surface] rounded-2xl` · supporting: `rounded-xl bg-[surface] border border-white/10`

**Responsive Collapse:**
- Desktop: 4-column bento grid with lead spanning 2×2
- Tablet: 2-column grid, lead still spans 2 cols
- Mobile: single-column stack, lead cell first, others as compact cards

**Motion:** SCALE_IN — cells appear with scale(0.95)→scale(1) + opacity, staggered 60ms apart. Easing: cubic-bezier(0.25, 1, 0.5, 1).

**Anti-Patterns:**
- All cells same size (no hierarchy — one must dominate)
- Empty cells or filler content
- Cells without distinct content purpose
- Uniform border treatment (vary: some borderless, some bordered)

**LLM Prompt Snippet:** "4-col bento grid, 3px gap, 8px padding. Lead cell col-span-2 row-span-2: headline 40px weight 700, subtitle 16px, filled CTA. Supporting cells: metric card (24px bold number + 12px label + sparkline), feature preview (icon 24px + title 14px 600 + one-liner 13px). Each cell: bg-[surface] rounded-xl border border-white/8. Staggered scale-in entrance."

---

## 6. Product Screenshot Hero

**ID:** `product-screenshot`
**When to use:** App launches, SaaS product pages, developer tool landing pages, B2B software
**Avoid for:** Abstract/brand-only pages, editorial, lifestyle

**Content Hierarchy:**
- Top section: headline 40–56px + subhead 16–18px + CTA group (centered or left)
- Below: large product screenshot/mockup (80-100% width, perspective-tilted or flat with shadow)
- Screenshot is the visual weight — headline sets up, screenshot delivers proof

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="pt-20 lg:pt-32 pb-0 overflow-hidden">
  <div data-ai-id="hero-content" class="text-center max-w-2xl mx-auto px-6 space-y-6 mb-12">
    <h1>...</h1>
    <p>...</p>
    <div class="cta-group flex justify-center gap-3">...</div>
  </div>
  <div data-ai-id="hero-media" class="max-w-5xl mx-auto px-4">
    <div class="rounded-t-xl border border-b-0 border-gray-200 shadow-2xl overflow-hidden">
      <img ... class="w-full" />
    </div>
  </div>
</section>
```

**CSS Pattern:** `pt-20 lg:pt-32 pb-0 overflow-hidden` · screenshot container: `rounded-t-xl border shadow-2xl` · screenshot fades into page bottom (gradient mask or cut-off)

**Responsive Collapse:**
- Desktop: centered text + large screenshot below (perspective tilt optional)
- Tablet: same structure, screenshot fills width
- Mobile: text-left, smaller heading, screenshot clipped at bottom with fade

**Motion:** SPRING_SOFT — text fades up (400ms), screenshot rises from below (translateY 40px→0, 500ms, 200ms delay). Optional subtle float animation on screenshot. Easing: cubic-bezier(0.25, 1, 0.5, 1).

**Anti-Patterns:**
- Screenshot from picsum or placeholder (must show real UI)
- Screenshot without border/shadow (floats without grounding)
- Screenshot fully visible without any compositional tension (crop bottom for intrigue)
- Headline competing with screenshot for visual weight

**LLM Prompt Snippet:** "Centered top section: headline 48px weight 700 tracking -1.2px, subtitle 18px weight 400 [secondary]. Two CTAs centered (filled primary + ghost). Below: product screenshot in container with rounded-t-xl, border border-gray-200, shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)]. Screenshot bottom cropped (overflow-hidden, no bottom border). Spring-soft entrance with 40px translateY."

---

## 7. Scroll-Trigger Reveal Hero

**ID:** `scroll-trigger-reveal`
**When to use:** Portfolio sites, creative agencies, award-worthy experiences, brand storytelling
**Avoid for:** Utility products, B2B SaaS, e-commerce (users need info fast)

**Content Hierarchy:**
- Initial viewport: minimal tease (brand mark + scroll indicator)
- On scroll: elements reveal in sequence (headline → media → details)
- Each reveal layer adds depth — builds narrative as user scrolls
- CTA appears last, after story is told

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="relative">
  <div class="min-h-[100dvh] flex items-center justify-center">
    <div data-ai-id="hero-tease" class="text-center">
      <span class="brand-mark">...</span>
      <div class="scroll-indicator mt-12">...</div>
    </div>
  </div>
  <div data-ai-id="hero-reveal" class="min-h-[80dvh] flex items-center px-6 lg:px-16">
    <div class="space-y-8 max-w-3xl">
      <h1 class="reveal-item">...</h1>
      <p class="reveal-item">...</p>
      <a class="reveal-item cta">...</a>
    </div>
  </div>
</section>
```

**CSS Pattern:** First viewport: `min-h-[100dvh] flex items-center justify-center` · reveal section: `min-h-[80dvh]` · each `.reveal-item`: initially `opacity-0 translate-y-8`, revealed via intersection observer or scroll-linked animation

**Responsive Collapse:**
- Desktop: full parallax experience with layered reveals
- Tablet: simplified parallax, fewer layers
- Mobile: reduce to 2 reveals max, faster transitions, smaller total scroll distance

**Motion:** CLIP_REVEAL — each element uses clip-path or translateY reveal triggered by scroll position. Stagger 200ms between elements. Parallax at 0.3x–0.5x speed. Easing: cubic-bezier(0.16, 1, 0.3, 1).

**Anti-Patterns:**
- Revealing everything at once (defeats the purpose)
- Scroll distance > 3 viewports before CTA (user loses patience)
- No fallback for users who don't scroll (must have minimal content in first viewport)
- Jarring parallax speeds (keep 0.3x–0.5x max)

**LLM Prompt Snippet:** "Two-part hero. First viewport: centered brand wordmark 24px [heading font] tracking-widest + animated scroll chevron. Second viewport (revealed on scroll): headline 56px weight 700 clip-path reveal (inset bottom→full), subtitle 18px fade-in 200ms later, CTA fade-in 400ms later. Parallax background layer at 0.4x speed. Total scroll: 1.8 viewports."

---

## 8. Dashboard Metric Hero

**ID:** `dashboard-metric`
**When to use:** Fintech dashboards, analytics admin panels, operations centers, real-time data products
**Avoid for:** Marketing pages, creative brands, consumer apps

**Content Hierarchy:**
- No traditional headline — metrics ARE the headline
- Lead metric: 48–64px tabular-nums font, prominent position
- Supporting metrics: 24–32px, row of 3-4 secondary KPIs
- Context line: 14px, explains what changed and timeframe
- CTA: subtle, inline action (not hero-style button)

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="p-6 lg:p-8 space-y-6">
  <div data-ai-id="hero-lead-metric" class="space-y-2">
    <span class="text-sm text-gray-500 uppercase tracking-wider">Total Revenue</span>
    <div class="text-5xl lg:text-6xl font-bold tabular-nums">$2.4M</div>
    <span class="text-sm text-emerald-500 flex items-center gap-1">↑ 12.3% vs last month</span>
  </div>
  <div data-ai-id="hero-metrics-row" class="grid grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="metric-card">...</div>
    <!-- 3 more -->
  </div>
</section>
```

**CSS Pattern:** `p-6 lg:p-8 space-y-6` · lead: `text-5xl lg:text-6xl font-bold tabular-nums` · metric cards: `bg-[surface] rounded-xl p-4 border border-[border-color]` · trend indicator: `text-sm text-emerald-500`

**Responsive Collapse:**
- Desktop: lead metric prominent + 4-col grid of secondary metrics
- Tablet: same structure, 2-col grid for secondaries
- Mobile: lead metric + 2-col grid, reduce to 2-3 most important secondaries

**Motion:** SCALE_IN — lead metric counts up (odometer effect, 800ms). Secondary cards stagger in (scale 0.95→1, 60ms apart). Easing: cubic-bezier(0.25, 1, 0.5, 1).

**Anti-Patterns:**
- Adding a marketing headline above metrics (this IS the hero)
- All metrics same size (one must dominate)
- Metrics without context (no timeframe, no comparison)
- Static numbers without sparkline or trend indicator

**LLM Prompt Snippet:** "No headline — metrics only. Lead: label 12px uppercase tracking-wider [muted], value 56px [heading font] weight 700 tabular-nums, trend +12.3% in emerald. Below: 4-col grid of metric cards (bg-[surface] border border-white/8 rounded-xl p-5): each has 12px label + 28px bold value + 11px sparkline area. Count-up animation on lead. Stagger scale-in on cards."

---

## 9. Text-Only Masthead Hero

**ID:** `text-only-masthead`
**When to use:** Editorial publications, magazine landing pages, blog homepages, literary brands
**Avoid for:** Tech products, dashboards, app launches

**Content Hierarchy:**
- Headline: 56–96px serif display font, dominant, editorial weight
- Deck/standfirst: 18–22px, max 2 lines, contrasting font (sans-serif if headline is serif)
- Byline or date: 12–14px, uppercase tracking-widest, decorative rule above or below
- No CTA in traditional sense — the content IS the destination
- Decorative elements: hairline rules, numbered issue markers, pull-quotes

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="py-16 lg:py-24 px-6 lg:px-16 border-b border-gray-200">
  <div class="max-w-4xl">
    <div class="flex items-center gap-4 mb-8">
      <span class="text-xs uppercase tracking-widest text-gray-500">Issue 47</span>
      <hr class="flex-1 border-gray-200" />
      <time class="text-xs text-gray-400">May 2026</time>
    </div>
    <h1 class="text-5xl lg:text-7xl font-serif leading-tight tracking-tight mb-6">...</h1>
    <p class="text-xl text-gray-600 max-w-2xl">...</p>
  </div>
</section>
```

**CSS Pattern:** `py-16 lg:py-24 px-6 lg:px-16 border-b` · heading: `text-5xl lg:text-7xl font-serif leading-tight tracking-tight` · deck: `text-xl text-[muted] max-w-2xl` · meta: `text-xs uppercase tracking-widest`

**Responsive Collapse:**
- Desktop: oversized headline with generous whitespace
- Tablet: text-5xl, same structure
- Mobile: text-3xl serif, tighter padding, meta stacks above headline

**Motion:** FADE_UP — headline fades up (400ms), deck 100ms later, meta line already visible (no animation). Easing: cubic-bezier(0.16, 1, 0.3, 1). Minimal — let typography breathe.

**Anti-Patterns:**
- Sans-serif headline (loses editorial character)
- Background colors or images (this archetype lives on pure whitespace)
- CTA buttons (editorial doesn't sell — it invites)
- Tight line-height on headline (needs room to breathe: 1.1–1.2)

**LLM Prompt Snippet:** "White bg. Left-aligned. Meta bar: 'Issue 47' 11px uppercase tracking-widest [muted] + hairline rule + date. Headline 72px [display serif] weight 600 tracking -2px line-height 1.1 [primary]. Deck 20px [body sans] weight 400 [secondary] max 2 lines. Border-b at bottom. 24px vertical padding. No CTA, no image. Fade-up entrance, typography-only."

---

## 10. Stacked Cards Hero

**ID:** `stacked-cards`
**When to use:** Premium SaaS, fintech, AI products, feature showcases with depth
**Avoid for:** Minimal brands, editorial, text-only contexts

**Content Hierarchy:**
- Headline + subhead + CTA in foreground (standard hero text)
- Behind: 2-3 cards stacked with perspective depth (rotated, offset, layered shadows)
- Cards show product features, screenshots, or abstract UI elements
- Depth creates visual interest and premium feel without images

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="min-h-[85dvh] relative flex items-center overflow-hidden">
  <div data-ai-id="hero-cards-bg" class="absolute right-0 top-1/2 -translate-y-1/2 w-[50%]">
    <div class="relative" style="perspective:1000px">
      <div class="card-back absolute rotate-3 translate-x-4 translate-y-4 opacity-60">...</div>
      <div class="card-mid absolute rotate-1 translate-x-2 translate-y-2 opacity-80">...</div>
      <div class="card-front relative">...</div>
    </div>
  </div>
  <div data-ai-id="hero-content" class="relative z-10 max-w-xl pl-8 lg:pl-16 space-y-6">
    <h1>...</h1>
    <p>...</p>
    <a class="cta">...</a>
  </div>
</section>
```

**CSS Pattern:** `min-h-[85dvh] relative flex items-center overflow-hidden` · cards: `absolute right-0 perspective-[1000px]` · each card: offset via `translate + rotate + opacity` · front card: full opacity, no rotation

**Responsive Collapse:**
- Desktop: text left, stacked cards right with perspective depth
- Tablet: cards above text, reduced rotation, 2 cards only
- Mobile: hide card stack entirely, show single feature card below text

**Motion:** SPRING_SOFT — cards float up individually with 100ms stagger, slight rotation animation settles. Text fades up simultaneously. Easing: cubic-bezier(0.25, 1, 0.5, 1).

**Anti-Patterns:**
- Cards with no meaningful content (empty cards = cheap)
- All cards same rotation/offset (needs variety)
- Flat cards without shadow depth (defeats stacking concept)
- More than 3 cards (visual noise)

**LLM Prompt Snippet:** "Split: text left 45%, card stack right 55%. Text: headline 48px weight 700, subtitle 18px, filled CTA. Cards: 3 stacked with perspective(1000px). Back: rotate(3deg) translate(16px,16px) opacity-50, shadow-xl. Mid: rotate(1.5deg) translate(8px,8px) opacity-75, shadow-lg. Front: no rotation, full opacity, shadow-2xl. Each card: bg-white rounded-xl border p-6 w-[320px] h-[200px]. Spring entrance with 100ms stagger."

---

## 11. Gradient Mesh Hero

**ID:** `gradient-mesh`
**When to use:** Premium AI products, music/streaming, crypto platforms, brand launches
**Avoid for:** Healthcare, education, conservative brands, editorial

**Content Hierarchy:**
- Background: multi-stop mesh gradient (3-4 colors, anchored to corners/edges, NOT floating blobs)
- Headline: 48–72px, white or dark depending on gradient, centered or left
- Subhead: 16–20px, 70% opacity
- CTA: glass-morphic or solid contrasting button
- Optional: subtle grain texture overlay (1-2% opacity)

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="relative min-h-[90dvh] flex items-center justify-center overflow-hidden">
  <div class="absolute inset-0">
    <div class="absolute inset-0" style="background: radial-gradient(ellipse at 20% 50%, rgba(accent1) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(accent2) 0%, transparent 40%), radial-gradient(ellipse at 50% 80%, rgba(accent3) 0%, transparent 45%), var(--color-bg)"></div>
    <div class="absolute inset-0 opacity-[0.015]" style="background-image:url(data:image/svg+xml,...)"></div>
  </div>
  <div data-ai-id="hero-content" class="relative z-10 text-center max-w-2xl px-6 space-y-6">
    <h1>...</h1>
    <p>...</p>
    <a class="cta">...</a>
  </div>
</section>
```

**CSS Pattern:** gradient: multiple `radial-gradient` layers anchored to specific positions (NOT centered blobs) · grain: SVG noise at 1.5% opacity · content: `relative z-10 text-center`

**Responsive Collapse:**
- Desktop: full gradient backdrop, centered content
- Tablet: same structure, simplify gradient to 2 stops
- Mobile: further simplify gradient, ensure text contrast maintained

**Motion:** SCALE_IN — gradient layers shift subtly on load (CSS animation, 20s loop, translateX 5%). Content fades in after 300ms. Easing: cubic-bezier(0.16, 1, 0.3, 1).

**Anti-Patterns:**
- Centered symmetrical blob (banned: generic gradient blob)
- Gradient with fewer than 3 hues (too flat)
- Missing grain texture (gradient feels digital/raw)
- Text without sufficient contrast against gradient (must pass 4.5:1)

**LLM Prompt Snippet:** "Dark base bg. Mesh: radial-gradient at 15% 60% ([accent1]/30% → transparent 50%), at 85% 25% ([accent2]/25% → transparent 40%), at 45% 85% ([accent3]/20% → transparent 45%). SVG noise overlay at opacity 0.015. Centered content: headline 60px weight 600 text-white tracking -2px, subtitle 18px text-white/65, glass CTA (backdrop-blur-xl bg-white/10 border border-white/20 px-6 py-3). Gradient layers animate translateX 3% over 20s."

---

## 12. Video Ambient Hero

**ID:** `video-ambient`
**When to use:** Entertainment brands, lifestyle products, travel, fashion, experiential marketing
**Avoid for:** B2B SaaS, developer tools, data products, accessibility-critical contexts

**Content Hierarchy:**
- Background: looping ambient video (muted, no audio, 5-15s loop)
- Static poster frame for load state and reduced-motion preference
- Dark overlay (40-60%) for text contrast
- Headline: 48–72px, white, bold, short (3-5 words)
- CTA: ghost or subtle filled, white-on-dark
- Minimal supporting text — video provides context

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="relative min-h-[100dvh] flex items-center justify-center overflow-hidden">
  <video class="absolute inset-0 w-full h-full object-cover" autoplay muted loop playsinline poster="poster.jpg">
    <source src="ambient.mp4" type="video/mp4" />
  </video>
  <div class="absolute inset-0 bg-black/50"></div>
  <div data-ai-id="hero-content" class="relative z-10 text-center text-white space-y-6 px-6">
    <h1>...</h1>
    <p>...</p>
    <a class="cta">...</a>
  </div>
</section>
```

**CSS Pattern:** video: `absolute inset-0 w-full h-full object-cover` · overlay: `absolute inset-0 bg-black/50` · content: `relative z-10 text-center text-white`

**Responsive Collapse:**
- Desktop: full video background, centered content
- Tablet: same, consider lighter video quality
- Mobile: replace video with poster image (bandwidth), maintain same overlay + text layout

**Motion:** CLIP_REVEAL — content fades in after 500ms (video needs time to start). No competing motion — video IS the motion. Easing: ease-out.

**Anti-Patterns:**
- Video without poster frame (blank flash on load)
- Auto-playing audio (never)
- Bright/busy video that competes with text
- No reduced-motion fallback (must show poster instead)
- Video longer than 15s (user moves on)

**LLM Prompt Snippet:** "Full-viewport video hero. Video: object-cover, autoplay muted loop playsinline, poster frame required. Overlay: bg-black/45. Content centered: headline 56px weight 700 text-white tracking -1.5px (3-5 words only), subtitle 16px text-white/70, ghost CTA (border border-white/30 text-white px-6 py-3 hover:bg-white/10). Content appears 500ms after load. Reduced-motion: show poster only."

---

## 13. Illustration-Led Hero

**ID:** `illustration-led`
**When to use:** Education platforms, health/wellness, kids products, friendly startups, onboarding
**Avoid for:** Enterprise, fintech, luxury, dark-mode products

**Content Hierarchy:**
- Central illustration: custom SVG or generated image (hero-sized, 300-500px)
- Headline: 36–52px, friendly/rounded font, weight 600-700
- Subhead: 16–18px, warm tone, max 100 chars
- CTA: rounded/pill shape, friendly color, inviting copy
- Layout: illustration above text (centered) or side-by-side (60 illus/40 text)

**HTML Skeleton:**
```html
<section data-ai-id="hero-section" class="py-16 lg:py-24 px-6">
  <div class="max-w-5xl mx-auto text-center space-y-8">
    <div data-ai-id="hero-illustration" class="mx-auto w-64 lg:w-80">
      <svg ...>...</svg>
    </div>
    <div data-ai-id="hero-content" class="space-y-4 max-w-lg mx-auto">
      <h1>...</h1>
      <p>...</p>
      <a class="cta">...</a>
    </div>
  </div>
</section>
```

**CSS Pattern:** `py-16 lg:py-24 text-center` · illustration: `mx-auto w-64 lg:w-80` · heading: `text-3xl lg:text-4xl font-bold` · CTA: `rounded-full px-8 py-3`

**Responsive Collapse:**
- Desktop: illustration centered above text, generous spacing
- Tablet: same layout, reduce illustration to 60% width
- Mobile: illustration 50% width, heading text-2xl, tighter spacing

**Motion:** SPRING_BOUNCY — illustration bounces in (scale 0.8→1.0 with overshoot, 500ms). Text fades up 200ms after. CTA subtle pulse on appear. Easing: cubic-bezier(0.34, 1.56, 0.64, 1).

**Anti-Patterns:**
- Generic Undraw/Blush illustrations (banned by anti-AI rules)
- Illustration smaller than 200px (loses impact)
- Dark/moody illustration with a bright playful layout (mood mismatch)
- Photo-realistic imagery (this archetype is about illustration character)

**LLM Prompt Snippet:** "Light warm bg (#fafaf8 or similar). Centered layout. Custom illustration: 320px wide SVG with [brand colors], character-driven or abstract-friendly style. Below: headline 40px [rounded sans: Nunito/Quicksand] weight 700 [primary], subtitle 17px weight 400 [secondary], pill CTA (rounded-full [accent] bg, white text, 15px weight 600, px-8 py-3.5). Illustration bounces in with spring overshoot. 24px spacing between illustration and text."

---

## Cross-Reference with Design Styles

When both this file and `design-styles-catalog.md` are loaded:
- **This file** provides the structural archetype (layout grid, content hierarchy, responsive collapse, HTML skeleton).
- **design-styles-catalog.md** provides the visual flavor (specific fonts, exact colors, materiality, surface recipes, CSS cues).
- The **LLM Prompt Snippet** in each archetype above uses placeholder tokens like `[heading font]`, `[primary color]`, `[accent color]`. Replace these with the actual values from the chosen style or frozen tokens.
- If the chosen style's "Hero archetypes" section suggests a specific variant (e.g., "split hero: headline left 60%, supporting detail right 40%"), use that as further refinement within the matching structural archetype from this file.
