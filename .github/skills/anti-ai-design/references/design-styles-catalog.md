# Design Styles Catalog

LLM-optimized catalog of the unified design style system extracted from `ai-agent-ui/antigravity-ui-extension/src/design-styles/`. Use this file in Phase 2 when the skill needs to propose 2-3 distinct visual directions and explain why one is the best fit.

## How to Use This Catalog

- Start with the **Category Index** to shortlist 2-3 directions that fit the product type and audience.
- Then load only the matching category section and pick concrete style entries.
- Prefer styles whose **product affinities** match the request and whose **product contrasts** avoid the request's domain.
- Use **forbidden treatments** and **anti-patterns** to prevent style drift during generation.
- If the user already has a brand, preserve their brand tokens but borrow typography, composition, motion, and surface logic from the chosen style.

## Category Index

| Category | Style Count | Best For | Watch Outs |
|---|---:|---|---|
| Minimal | 3 | SaaS, Minimal, Productivity, Documentation | Luxury, Entertainment, Playful |
| Editorial | 6 | Wellness, Food, Sustainability, Luxury | Tech, Fintech, Dashboard |
| Brutalist | 4 | Events, Sports, Media, Creative-Agency | Healthcare, Finance, Enterprise |
| Dark Luxury | 5 | Fintech, Dashboard, Crypto, AI | Education, Healthcare, E-commerce |
| Glassmorphism | 3 | Premium-SaaS, Music, Social, Gaming | Enterprise, Healthcare, Education |
| Industrial | 3 | Developer-Tools, IDE, Documentation, Architecture | Fashion, Food, Healthcare |
| Playful | 3 | Education, E-commerce, Kids, Social | Enterprise, Fintech |
| Cinematic | 2 | Film, Photography, Architecture, Portfolio | E-commerce, Kids, Healthcare |
| Poster | 2 | Restaurant, Hospitality, Craft, Culture | Tech, Developer-Tools, Dashboard |
| Tech | 4 | AI, Data-Science, Fintech, Space | Kids, Wellness, Healthcare |
| Commerce | 1 | E-commerce, Marketplace, DTC | Portfolio, Documentation |

**Coverage:** 36 styles across 11 categories.

## Minimal

**When to reach for this category:** SaaS, Minimal, Productivity, Documentation, Developer-Tools, Dashboard, Corporate.

### Nordic Minimal

- **Style ID:** `nordic-minimal`
- **Description:** Clean Scandinavian restraint with breathable whitespace and hairline borders. Typographic confidence anchors left-aligned heroes over warm neutral backgrounds. Functional beauty — nothing decorative, everything intentional.
- **Typography:** Heading `Space Grotesk`, body `Inter`. Headings: Space Grotesk 600–700, tight tracking (-0.02em). Body: Inter 400, 1.6 line-height. Use uppercase tracking-widest for labels. Avoid mixing weights beyond 2 per section.
- **Color direction:** primary #2d2d2d, secondary #6b7280, accent #6b7f3b, background #fafafa, text #1a1a1a
- **Layout DNA:** left-aligned-hero; radius 4px; density spacious; shadow 0 1px 3px rgba(0,0,0,0.06)
- **Materiality:** Flat matte surfaces. Hairline 1px borders in gray-200. No texture, no gradients. Whitespace is the primary design element.
- **Motion:** FADE_UP — Fade-up 20px over 300ms. Stagger children 60ms apart. Easing: cubic-bezier(0.16,1,0.3,1). No bounce, no spring. On scroll only.
- **Icons:** heroicons (outlined)
- **Best fit products:** SaaS, Minimal, Productivity
- **Avoid for:** Luxury, Entertainment
- **Audience personas:** design-conscious-professionals, startup-founders
- **Signature motifs:**
- oversized left-aligned heading with 1px hairline rule below
- uppercase tracking-widest labels as section markers
- narrow max-width content column (max-w-xl) on wide canvas
- minimal nav with text-only links, no icons in header
- generous vertical padding (py-16 to py-24) between sections
- **Hero archetypes:**
- full-width text hero: oversized left-aligned h1, single-sentence sub, borderless CTA
- split hero: headline left 60%, supporting detail right 40%, hairline vertical rule
- text-only masthead with numbered decorative rule and scroll indicator
- **WOW effects:**
- hairline horizontal rule that extends full viewport width beyond content column
- oversized transparent text watermark behind content at 4% opacity
- staggered fade-up of list items at 60ms intervals
- hover underline animation via width: 0 → 100% on ::after
- **Surface recipes:**
- bg-gray-50 border border-gray-100 rounded p-6 — flat card with near-invisible border
- bg-white border-b border-gray-200 pb-8 mb-12 — section divider card
- **Prompt-safe CSS cues:**
- border-b border-gray-200 pb-8 mb-12
- text-left max-w-xl space-y-4
- bg-gray-50 border border-gray-100 rounded p-6
- tracking-tight font-semibold text-4xl text-gray-900
- text-gray-500 text-sm uppercase tracking-widest
- **Anti-patterns:**
- centered hero without motion
- heavy drop shadows (box-shadow with blur > 8px)
- gradients on backgrounds or text
- rounded-3xl or pill shapes
- decorative icons in headlines
- **Forbidden treatments:**
- glassmorphism or frosted surfaces
- neon or saturated accent colors
- serif headings — sans-serif only
- dark mode inverted color scheme
- **Copy tone:** Direct and confident. Short sentences. No filler adjectives. Headlines: 4-6 words. CTA: single verb.

### Pure Flat

- **Style ID:** `pure-flat`
- **Description:** Ultra-flat surfaces with zero depth — no shadows, no borders, color-only hierarchy with generous whitespace. Slate backgrounds and muted text create calm visual rhythm. Everything breathes; nothing competes for attention.
- **Typography:** Heading `DM Sans`, body `DM Sans`. Single-family system: DM Sans throughout. Headings: 600–700 weight, -0.025em tracking. Body: 400 weight, 1.65 line-height. Size hierarchy by font-size only — no border, shadow, or decoration distinguishes levels. Labels: 12px, 500 weight, uppercase.
- **Color direction:** primary #1e293b, secondary #64748b, accent #3b82f6, background #f8fafc, text #334155
- **Layout DNA:** single-column-stack; radius 12px; density spacious; shadow none
- **Materiality:** Color is structure. Slate-50 vs slate-100 distinguishes surfaces without borders. Blue accent blocks replace decorative dividers. No box-shadow anywhere in the UI.
- **Motion:** FADE_UP — Fade-up 24px over 320ms. Stagger sibling blocks 80ms. Easing: ease-out. Page load: sequential reveal top to bottom. No hover animations beyond opacity nudge.
- **Icons:** lucide (outlined)
- **Best fit products:** SaaS, Documentation, Developer-Tools
- **Avoid for:** Luxury, Entertainment
- **Audience personas:** developers, technical-writers
- **Signature motifs:**
- large color-fill block used as section divider instead of border
- blue pill tag replacing traditional heading decoration
- full-width accent bg-blue-50 strip between neutral sections
- icon and text at same visual weight — neither dominates
- **Hero archetypes:**
- stacked single-column hero: label → h1 → subtext → CTA, all left-aligned with 40px gaps
- color-block split: left pale surface, right accent-blue surface, copy centered in each
- **WOW effects:**
- color transition on scroll: bg shifts from slate-50 to white as section enters view
- blue accent block appears via scale-x 0→1 left-to-right on load
- text reveal: words opacity 0→1 sequentially over 600ms total
- **Surface recipes:**
- bg-slate-100 rounded-xl p-8 — borderless flat card, color defines boundary
- bg-blue-50 rounded-lg px-4 py-2 — accent surface for featured content
- **Prompt-safe CSS cues:**
- bg-slate-50 min-h-screen
- max-w-2xl mx-auto px-6 py-16 space-y-12
- bg-slate-100 rounded-xl p-8
- bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-xs font-medium
- text-slate-900 text-4xl font-semibold tracking-tight leading-tight
- **Anti-patterns:**
- any box-shadow on cards or containers
- visible borders (border-gray-200 etc.) as structure
- gradient backgrounds or text-gradient
- multiple font families
- compact density — pure-flat needs room to breathe
- **Forbidden treatments:**
- glassmorphism or backdrop-blur
- dark mode surface without complete palette swap
- serif fonts anywhere in the layout
- **Copy tone:** Developer-friendly clarity. Direct and factual. Short sentences. Code-adjacent language accepted. CTAs: imperative verbs.

### Swiss Precision

- **Style ID:** `swiss-precision`
- **Description:** Grid-perfect Helvetica-era rigour with a strict 12-column system and zero decoration. Proportional spacing, baseline rhythm, and numbered section markers define every layout. Pure function elevated to art form.
- **Typography:** Heading `Inter`, body `Inter`. Headings: Inter 700–900, tight tracking (-0.04em), uppercase where applicable. Body: Inter 400. Mono labels: font-mono text-xs tracking-widest. All text aligned to baseline grid (8px unit). Helvetica Neue fallback: font-family: "Helvetica Neue", Inter, sans-serif.
- **Color direction:** primary #000000, secondary #4b5563, accent #dc2626, background #ffffff, text #1a1a1a
- **Layout DNA:** 12-col-grid; radius 2px; density compact; shadow none
- **Materiality:** Absolute flatness — no shadows, no gradients, no texture. Structure emerges purely from grid, proportion, and typography weight. Black borders on white: maximum contrast.
- **Motion:** FADE_UP — Fade-up 16px over 250ms. Linear easing only. No springs, no bounces. State transitions: opacity crossfade 150ms. Motion serves clarity, never decoration.
- **Icons:** heroicons (outlined)
- **Best fit products:** SaaS, Dashboard, Corporate
- **Avoid for:** Playful, Entertainment
- **Audience personas:** enterprise-users, data-analysts
- **Signature motifs:**
- strict 12-column grid with visible baseline rhythm
- numbered section markers in mono font (01, 02, 03)
- border-l-4 border-black as strong visual divider
- all-caps category labels with wide letter-spacing
- content offset in grid — not centered, but precisely placed
- **Hero archetypes:**
- grid masthead: title spans col-1 to col-8, meta in col-9 to col-12
- asymmetric split: text occupies col-span-7, statistics col-span-5
- **WOW effects:**
- full-width horizontal rule at exact 1px with no margin blur
- bold red accent on a single word in an otherwise black headline
- number counter stepping through values at 20ms intervals
- **Surface recipes:**
- bg-white border-t border-gray-900 pt-4 — rule-top section header
- col-span-8 border-l-4 border-black pl-6 — grid-anchored content block
- bg-gray-50 p-0 border border-gray-900 — flat inset panel
- **Prompt-safe CSS cues:**
- grid grid-cols-12 gap-x-4 gap-y-0
- col-span-8 border-l-4 border-black pl-6
- text-xs font-mono text-gray-400 tracking-widest uppercase
- border-t border-gray-900 pt-4
- max-w-screen-xl mx-auto px-8
- **Anti-patterns:**
- decorative blurs or gradients
- asymmetric overlapping elements
- rounded corners beyond 4px
- motion beyond fade (no spring, no bounce)
- serif or display fonts in headings
- **Forbidden treatments:**
- glassmorphism or frosted panels
- drop shadows of any kind
- multiple accent colors — red accent only
- centered single-column layout on wide viewports
- decorative imagery without grid alignment
- **Copy tone:** Authoritative and precise. Noun-first headlines. No embellishments. Numbers over adjectives. Every word earns its place.


## Editorial

**When to reach for this category:** Wellness, Food, Sustainability, Luxury, Creative, Fashion, Finance, Real-Estate, Lifestyle, Home, Craft, Media, Publishing, Portfolio, Education, Culture.

### Earthy Organic

- **Style ID:** `earthy-organic`
- **Description:** Earth-toned editorial with organic variable-weight typography and natural warmth — terracotta and olive on cream. Generous whitespace frames content like a nature journal. Slow, deliberate, and tactile.
- **Typography:** Heading `Fraunces`, body `Source Sans 3`. Headings: Fraunces 700–900, optical-size large, tight line-height (1.15). Body: Source Sans 3 400, 1.7 line-height. Pull-quotes: Fraunces italic 400. Avoid mixing more than two weights per page. Let the organic letterforms breathe.
- **Color direction:** primary #6b4f3f, secondary #a1866d, accent #8b6f4e, background #f5efe6, text #3d3028
- **Layout DNA:** asymmetric-editorial; radius 12px; density spacious; shadow 0 2px 12px rgba(107,79,63,0.1)
- **Materiality:** Warm parchment surfaces. Subtle off-white texture implied through color variation rather than noise. Soft rounded corners for organic feel. Borders in warm brown tint, never cool gray.
- **Motion:** FADE_UP — Gentle fade-up 28px over 420ms. Natural easing: ease-in-out. Stagger sections 100ms apart. No clip or snap — everything transitions organically. Like pages turning.
- **Icons:** tabler (outlined)
- **Best fit products:** Wellness, Food, Sustainability
- **Avoid for:** Tech, Fintech
- **Audience personas:** wellness-conscious-consumers, sustainable-brand-founders
- **Signature motifs:**
- oversized organic serif heading with natural irregular letterforms
- terracotta/olive color accent swath used as section backdrop
- hand-drawn style dividers via border-dashed in warm brown
- side-margin illustration or texture patch at 20% opacity
- **Hero archetypes:**
- full-width image hero with warm color overlay and left-aligned organic serif title
- asymmetric split: nature image left 45%, editorial text right with generous vertical padding
- text-only hero on parchment: large Fraunces heading, olive subline, terracotta CTA
- **WOW effects:**
- accent color block slides in from left behind headline on scroll entry
- background transitions from cream to warm brown at section boundary
- image reveals with 600ms fade from warm overlay to full color
- typewritten word-by-word effect on key headline, 40ms per word
- **Surface recipes:**
- bg-[#ede4d8] rounded-xl p-8 — warm parchment card
- bg-[#f5efe6] border border-[rgba(107,79,63,0.2)] rounded-xl p-6 — paper-toned bordered module
- **Prompt-safe CSS cues:**
- bg-[#f5efe6] min-h-screen font-sans
- max-w-3xl mx-auto px-8 py-20 space-y-16
- bg-[#ede4d8] rounded-xl p-8 border border-[rgba(107,79,63,0.15)]
- font-serif text-5xl font-bold text-[#3d3028] leading-tight
- text-[#8b6f4e] text-sm uppercase tracking-widest font-medium
- **Anti-patterns:**
- cool gray or blue-tinted neutral backgrounds
- sharp geometric sans headlines as primary display
- neon or high-saturation accent colors
- dense grid layouts with no breathing room
- dark backgrounds — warmth requires light surfaces
- **Forbidden treatments:**
- glassmorphism or digital-glass effects
- hard drop shadows with cool color cast
- monospace or code fonts in editorial context
- compact or information-dense layouts
- **Copy tone:** Warm and thoughtful. Narrative sentences with natural rhythm. Nature metaphors welcome. CTAs: invitational rather than imperative.

### Editorial Luxury

- **Style ID:** `editorial-luxury`
- **Description:** Magazine-premium full-bleed layouts with expressive serif display and terracotta warmth on cream. Editorial spacing, asymmetric CSS Grid, and clip-path reveals evoke print luxury. An aesthetic rooted in craft, paper, and intentional narrative.
- **Typography:** Heading `Playfair Display`, body `Plus Jakarta Sans`. Headings: Playfair Display 700–900, tight line-height (1.1). Italic accent on key words. Body: Plus Jakarta Sans 400, 1.65 line-height. Pull-quotes: Playfair Display italic 700, large size. Avoid all-caps headings — preserve editorial readability.
- **Color direction:** primary #2d2d2d, secondary #6b7f3b, accent #c4683f, background #faf5e4, text #2d2d2d
- **Layout DNA:** full-bleed-hero; radius 8px; density spacious; shadow 0 4px 20px rgba(139,90,43,0.12)
- **Materiality:** Paper/ink feel via subtle SVG noise at 1.5% opacity. Warm shadows rgba(139,90,43,0.12). 1px hairline borders in terracotta tint. Surfaces feel like premium print, never digital glass.
- **Motion:** CLIP_REVEAL — Scroll-triggered reveals: slide-up 20px + opacity fade 400ms. Parallax text at 0.5x speed. Easing: cubic-bezier(0.16,1,0.3,1). Clip-path reveal on hero image: inset(100% 0 0 0) → inset(0% 0 0 0). Never flashy.
- **Icons:** lucide (rounded)
- **Best fit products:** Luxury, Creative, Fashion
- **Avoid for:** Tech, Dashboard
- **Audience personas:** creative-directors, brand-managers
- **Signature motifs:**
- asymmetrical masthead with oversized serif headline spanning two-thirds width
- numbered sections styled like book chapters (01, 02)
- margin annotations as aside elements in small italic
- framed content modules with 1px hairline terracotta borders
- contrast between expressive serif display and sober sans body
- **Hero archetypes:**
- full-bleed image hero with serif headline overlaid at 90% height on warm overlay
- split masthead: image left 55% + editorial headline right with generous whitespace
- text-only hero with oversized tracking and decorative horizontal rule
- **WOW effects:**
- subtle SVG noise texture overlay at 1.5% opacity on cream background
- warm rgba shadows giving print paper depth without digital glow
- pull-quote block with oversized serif at 5xl and left border-4 terracotta
- clip-path hero image reveal: curtain drops top to bottom over 700ms
- **Surface recipes:**
- bg-[#faf5e4] with SVG noise at 1.5% opacity — premium paper surface
- border border-[rgba(139,90,43,0.15)] rounded-lg shadow-[0_4px_20px_rgba(139,90,43,0.12)] — warm bordered card
- border-l-4 border-[#c4683f] pl-6 italic font-serif text-2xl — terracotta pull-quote
- **Prompt-safe CSS cues:**
- w-full h-screen relative overflow-hidden
- absolute bottom-12 left-12 right-12 text-white
- font-serif text-6xl leading-none tracking-tight
- border-t border-[rgba(139,90,43,0.15)] pt-4 mt-4
- mix-blend-multiply bg-black/40 absolute inset-0
- **Anti-patterns:**
- card-based grid layouts as primary structure
- sans-serif body font used as hero headline
- pastel or cool-blue color palette
- navigation bars embedded inside hero area
- **Forbidden treatments:**
- glassmorphism or frosted panels
- neon accent colors
- hard drop shadows (box-shadow with spread > 8px)
- monospace or tech-style fonts
- dark mode backgrounds — cream/ivory only
- **Copy tone:** Confident editorial voice. Short declarative sentences. No tech jargon. Headlines: 3–5 words. Subhead: single sentence. CTA: verb-first.

### Forest Green Grid

- **Style ID:** `forest-green-grid`
- **Description:** Deep forest greens and structured editorial grid — nature-informed luxury with precise Swiss composition. Libre Baskerville serif headings over mint backgrounds create authority and environmental credibility. Rigorous layout, organic soul.
- **Typography:** Heading `Libre Baskerville`, body `Work Sans`. Headings: Libre Baskerville 700, line-height 1.2. Italic subheads for editorial tone. Body: Work Sans 400, line-height 1.6. Section numbers: Work Sans 500, small-caps, deep forest green. Grid alignment is mandatory — no freeform positioning.
- **Color direction:** primary #1b4332, secondary #40916c, accent #52b788, background #f0fdf4, text #1b4332
- **Layout DNA:** 12-col-grid; radius 4px; density compact; shadow 0 1px 4px rgba(27,67,50,0.1)
- **Materiality:** Crisp mint-green surfaces with zero decoration. Flat grid panels bordered in forest/15. Authority comes from structure, not texture. Every element occupies an exact grid column.
- **Motion:** FADE_UP — Fade-up 16px over 280ms. Grid rows enter top to bottom, columns left to right, 50ms stagger. Easing: ease-out. No spring — editorial grids have no bounce.
- **Icons:** heroicons (outlined)
- **Best fit products:** Sustainability, Finance, Real-Estate
- **Avoid for:** Gaming, Entertainment
- **Audience personas:** sustainability-officers, impact-investors
- **Signature motifs:**
- strict 12-column grid with forest-green left border on feature column
- deep forest primary as dominant heading color — no black
- numbered environmental metrics in accent green — stat-heavy layouts
- hairline horizontal rule in forest/15 for grid row separation
- **Hero archetypes:**
- grid masthead: forest green headline col-1 to col-8, green metric cards col-9 to col-12
- editorial split: hero image col-span-7 with mint overlay, key stat block col-span-5
- **WOW effects:**
- green progress bars that fill on scroll entry — representing environmental metrics
- grid lines briefly visible (1px forest/10) on page load then fade to transparent
- stat counters animate from 0 to value over 1s using ease-out
- **Surface recipes:**
- bg-[#dcfce7] rounded border border-[rgba(27,67,50,0.12)] p-6 — mint grid cell
- border-l-4 border-[#1b4332] pl-6 — forest-green feature column accent
- bg-[#f0fdf4] border-t border-[rgba(27,67,50,0.15)] pt-4 — section row divider
- **Prompt-safe CSS cues:**
- grid grid-cols-12 gap-x-4 max-w-screen-xl mx-auto px-8
- col-span-8 border-l-4 border-[#1b4332] pl-6
- bg-[#dcfce7] rounded border border-[rgba(27,67,50,0.12)] p-6
- font-serif text-4xl font-bold text-[#1b4332] leading-tight
- text-[#40916c] text-xs font-medium uppercase tracking-widest
- **Anti-patterns:**
- warm earth tones or terracotta — this is forest, not desert
- asymmetric overlapping elements — grid discipline required
- rounded corners beyond 4px
- dark backgrounds — mint/light surfaces only
- playful or bouncy motion
- **Forbidden treatments:**
- glassmorphism or translucent panels
- blue or tech-gray color palette
- decorative blurs or gradients
- non-grid freeform layout positioning
- **Copy tone:** Authoritative and data-driven. Sustainability credentials stated plainly. Numbers first. Short precise sentences. No greenwashing adjectives.

### Matte Earth Toned

- **Style ID:** `matte-earth-toned`
- **Description:** Muted earthy palette with matte surfaces and subtle grain — warm sophistication without gloss. DM Serif Display headings in dark umber over warm linen backgrounds. Unhurried, grown-up, and artisan in character.
- **Typography:** Heading `DM Serif Display`, body `Karla`. Headings: DM Serif Display regular (one weight only), large size only (3xl+), line-height 1.15. Italic variant for softer sections. Body: Karla 400, line-height 1.65. Labels: Karla 600, text-xs, uppercase, tracked. Never use DM Serif Display below 2xl.
- **Color direction:** primary #5c4f3d, secondary #8a7060, accent #b8860b, background #f3ede4, text #3d3425
- **Layout DNA:** asymmetric-editorial; radius 16px; density balanced; shadow 0 4px 16px rgba(92,79,61,0.1)
- **Materiality:** Matte linen surfaces with implied grain — achieved via subtle background-color variation rather than texture overlay. Warm shadow with umber tint. Generous border-radius creates soft, handcrafted feel.
- **Motion:** SPRING_SOFT — Soft spring: stiffness 80, damping 18. Translate-y 24px → 0 on entry. Stagger cards 90ms. Card hover: slight scale 1.01 with shadow deepen over 200ms. Warmth in every transition.
- **Icons:** tabler (rounded)
- **Best fit products:** Lifestyle, Home, Craft
- **Avoid for:** Tech, Gaming
- **Audience personas:** artisan-brand-founders, home-decor-enthusiasts
- **Signature motifs:**
- DM Serif Display heading paired with karla all-caps label above
- dark gold accent as single focal color against umber surfaces
- rounded card with 16px radius — softer than typical editorial
- asymmetric two-column: wide image column + narrow editorial column
- umber/brown section background alternating with linen base for rhythm
- **Hero archetypes:**
- asymmetric hero: image panel left 60% with 16px radius, editorial text right with vertical rhythm
- linen backdrop text hero: DM Serif Display 6xl heading, Karla subline, gold CTA button
- split grid: alternating image-left and image-right sections for product editorial
- **WOW effects:**
- card group enters with staggered spring bounce at 90ms intervals
- gold accent line draws under headline from left on viewport entry (width 0→60px)
- background shifts from linen #f3ede4 to warm umber #e8ddd0 between sections
- **Surface recipes:**
- bg-[#e8ddd0] rounded-2xl p-8 border border-[rgba(92,79,61,0.15)] — warm matte card
- bg-[#f3ede4] with border-b border-[rgba(92,79,61,0.18)] pb-8 — section divider
- **Prompt-safe CSS cues:**
- bg-[#f3ede4] min-h-screen text-[#3d3425]
- max-w-5xl mx-auto px-8 py-16
- bg-[#e8ddd0] rounded-2xl p-8 border border-[rgba(92,79,61,0.15)]
- font-serif text-5xl text-[#5c4f3d] leading-tight
- text-[#b8860b] text-xs uppercase tracking-widest font-semibold
- **Anti-patterns:**
- high-gloss or glossy surface treatments — matte only
- cool gray or blue-cast neutrals
- sharp corners (below 8px radius) — softness is essential
- bright or electric accent colors
- dense information-heavy layouts
- **Forbidden treatments:**
- glassmorphism or any translucent layer
- dark backgrounds — linen warmth only
- monospace fonts — artisan aesthetic requires serif/humanist
- **Copy tone:** Artisan warmth. Craft-forward language. Sensory descriptions welcome. Headlines: evocative fragments. CTAs: gentle and invitational.

### Midnight Editorial

- **Style ID:** `midnight-editorial`
- **Description:** Dark editorial with ivory text on deep navy — cinematic magazine layouts meet dark-mode elegance. Gold accents and serif headlines create a brooding, sophisticated atmosphere. Like reading a luxury magazine by candlelight.
- **Typography:** Heading `Lora`, body `DM Sans`. Headings: Lora 600–700, tight line-height (1.15). Italic headlines create cinematic drama. Body: DM Sans 400, 1.65 line-height, ivory (#e8e0d0). Subheadings: DM Sans 500, small-caps optional. Gold accent only on CTAs and key data points.
- **Color direction:** primary #e8e0d0, secondary #a09880, accent #c9a96e, background #0f1419, text #e8e0d0
- **Layout DNA:** full-bleed-hero; radius 4px; density balanced; shadow 0 8px 32px rgba(0,0,0,0.4)
- **Materiality:** Deep navy backgrounds with near-black surface variants. No bright surfaces — depth through darkness. Gold accent provides editorial focal point. Borders in ivory/10 — barely visible hairlines.
- **Motion:** CLIP_REVEAL — Clip-path reveals from bottom: inset(100% 0 0 0) → inset(0%). Duration 600ms. Easing: cubic-bezier(0.16,1,0.3,1). Crossfade on page transitions 400ms. No spring, no bounce — cinematic gravity.
- **Icons:** lucide (outlined)
- **Best fit products:** Media, Publishing, Portfolio
- **Avoid for:** Healthcare, Education
- **Audience personas:** luxury-content-consumers, editorial-photographers
- **Signature motifs:**
- full-bleed dark hero with serif headline positioned at optical center
- gold horizontal rule as section break — 1px solid gold/30
- large roman numeral chapter markers in ivory/20
- dark card module with ivory/10 border — barely-there framing
- **Hero archetypes:**
- cinematic full-viewport dark hero: centered Lora italic heading, gold subline, ivory CTA
- editorial masthead on #0f1419: section number left, oversized heading center, date right
- **WOW effects:**
- clip-path curtain reveal on hero image — 700ms from bottom upward
- gold accent line draws across from left on scroll: width 0 → 100% over 600ms
- dark card lifts with shadow intensify on hover: shadow-lg → shadow-2xl
- typeface crossfade: body copy fades in letter by letter over 800ms on load
- **Surface recipes:**
- bg-[#1a2030] border border-[rgba(232,224,208,0.1)] rounded p-6 — dark editorial card
- bg-[#0f1419] with gold 1px bottom border — section divider strip
- **Prompt-safe CSS cues:**
- bg-[#0f1419] text-[#e8e0d0] min-h-screen
- font-serif text-5xl leading-tight italic text-[#e8e0d0]
- bg-[#1a2030] border border-[rgba(232,224,208,0.08)] rounded p-6
- text-[#c9a96e] text-xs uppercase tracking-widest font-medium
- border-t border-[rgba(201,169,110,0.3)] pt-6 mt-6
- **Anti-patterns:**
- light or white backgrounds — dark theme only
- bright saturated colors besides gold accent
- rounded-xl or pill shapes — sharp edges only
- playful or bouncy motion — cinematic gravity required
- **Forbidden treatments:**
- glassmorphism or frosted-glass panels
- warm cream or paper backgrounds
- blue or purple accent colors
- sans-serif used as hero display font
- **Copy tone:** Atmospheric and measured. Short precise statements. Cinematic energy in headlines. Gold-standard quality implied by every word choice.

### Organic Serif

- **Style ID:** `organic-serif`
- **Description:** Organic editorial with warm serif pairing and generous whitespace — literary and contemplative. Crimson Pro headings and muted taupe surfaces create a reading-room atmosphere. Designed for long-form content that deserves to be savored.
- **Typography:** Heading `Crimson Pro`, body `Nunito Sans`. Headings: Crimson Pro 600–700, italic for sub-headings, line-height 1.2. Body: Nunito Sans 400, line-height 1.75 for comfortable reading. Drop-cap first letter on long articles. Max content width 72ch for optimal line length.
- **Color direction:** primary #4a4238, secondary #7a6a57, accent #9b7e5e, background #faf7f2, text #3d362e
- **Layout DNA:** split-hero; radius 8px; density spacious; shadow 0 2px 16px rgba(74,66,56,0.08)
- **Materiality:** Warm off-white surfaces — not pure white, not cream, but the color of aged paper. Subtle warm-tinted shadows. 1px borders in brown/15. Surfaces feel like a well-loved library.
- **Motion:** SPRING_SOFT — Soft spring: stiffness 100, damping 20. Fade-up 20px on enter. Paragraph reveals: stagger lines 80ms. Reading progress indicator: smooth-scroll fill. Nothing jarring — the user is in a contemplative state.
- **Icons:** phosphor (rounded)
- **Best fit products:** Publishing, Education, Culture
- **Avoid for:** Dashboard, Fintech
- **Audience personas:** avid-readers, academic-researchers
- **Signature motifs:**
- large drop-cap initial letter in Crimson Pro for article opens
- wide left margin with floating annotation or pull-quote
- numbered footnotes styled as academic citations
- thin horizontal rule with centered ornament (◆) between sections
- author byline with small circular avatar inline
- **Hero archetypes:**
- split hero: warm image left 50%, article headline + deck + author right, lots of vertical padding
- text-only editorial hero: date + category breadcrumb, oversized Crimson Pro heading, italic subheading
- **WOW effects:**
- first letter drop-cap that scales up and settles with spring animation on page load
- reading progress bar in accent brown fills horizontally as user scrolls
- pull-quote slides in from margin with 400ms spring translate-x
- **Surface recipes:**
- bg-[#f0ebe2] rounded-lg p-8 border border-[rgba(74,66,56,0.12)] — library card
- bg-[#faf7f2] p-10 max-w-[72ch] mx-auto — optimal reading column
- **Prompt-safe CSS cues:**
- bg-[#faf7f2] min-h-screen text-[#3d362e]
- max-w-[72ch] mx-auto px-8 py-16 space-y-10
- bg-[#f0ebe2] rounded-lg p-8 border border-[rgba(74,66,56,0.12)]
- font-serif text-5xl font-semibold text-[#4a4238] leading-snug
- border-l-4 border-[#9b7e5e] pl-6 italic text-xl text-[#7a6a57]
- **Anti-patterns:**
- bright or saturated color accents — warmth only
- sans-serif heading as article headline
- dense grid with many columns — single reading column preferred
- dark backgrounds — warm light surfaces only
- heavy drop shadows that break the flat paper aesthetic
- **Forbidden treatments:**
- glassmorphism or blur effects
- monospace fonts — this is literary, not technical
- tight line-height below 1.6 on body text
- **Copy tone:** Thoughtful and literary. Varied sentence length. Em-dashes for rhythm. Headlines: curious questions or fragments. CTAs: softer invitations.


## Brutalist

**When to reach for this category:** Events, Sports, Media, Creative-Agency, Music, Streetwear, Fashion, Portfolio, Developer-Tools, Startup.

### Kinetic Orange

- **Style ID:** `kinetic-orange`
- **Description:** High-energy brutalist with burnt orange as explosive accent — raw industrial typography meets bold color blocking.
- **Typography:** Heading `Archivo Black`, body `DM Sans`. Archivo Black for all headings — use only weight 400 (inherently heavy); DM Sans for body; uppercase headings with tight tracking; scale headings aggressively at 8vw+.
- **Color direction:** primary #ea580c, secondary #000000, accent #fb923c, background #fef3c7, text #1c1917
- **Layout DNA:** dense-grid; radius 0; density compact; shadow 4px 4px 0 #000
- **Materiality:** Hard black borders on warm cream background. Burnt orange color blocks as section anchors. Zero blur, zero gradients. Industrial scaffold structure — every element framed.
- **Motion:** SPRING_SNAPPY — Snap interactions: hover shifts element 2px up, shadow shrinks to 2px 2px 0 #000. Click collapses shadow to zero. No spring, no ease — energy through abruptness alone.
- **Icons:** material-symbols (sharp)
- **Best fit products:** Events, Sports, Media
- **Avoid for:** Healthcare, Finance
- **Audience personas:** young-professionals, event-organizers
- **Signature motifs:**
- burnt orange color blocks as section dividers and CTA backgrounds
- thick black borders on warm cream surfaces
- all-caps Archivo Black at oversized scale as graphic element
- hard 4px shadow offset on interactive cards
- **Hero archetypes:**
- full-bleed orange header block with black Archivo Black headline and cream subtext
- split-block hero: cream left panel / orange right panel with 4px black divider line
- **WOW effects:**
- orange-to-black high-contrast color split on card hover state
- oversized Archivo Black at 15vw+ used as watermark background element
- hard border collapse animation on card press — shadow snaps from 4px to zero
- **Surface recipes:**
- card: bg-amber-50 border-4 border-black shadow-[4px_4px_0_#000] rounded-none p-5
- cta block: bg-orange-600 border-4 border-black text-white font-black uppercase tracking-widest
- **Prompt-safe CSS cues:**
- bg-amber-50 border-4 border-black shadow-[4px_4px_0_#000]
- bg-orange-600 text-white font-black uppercase tracking-widest rounded-none
- text-stone-900 text-5xl font-black leading-none tracking-tight uppercase
- grid grid-cols-2 gap-0 border-4 border-black [&>*]:border-2 [&>*]:border-black
- hover:shadow-[2px_2px_0_#000] hover:-translate-y-px active:shadow-none active:translate-y-0 transition-none
- **Anti-patterns:**
- rounded corners or pill shapes
- gradients or color transitions
- soft or blurred shadows
- pastel or desaturated color palette
- **Forbidden treatments:**
- border-radius beyond 0px
- any gradient including linear or radial
- glassmorphism or backdrop-blur effects
- **Copy tone:** High-energy and direct. Action-oriented imperatives. Short bursts of copy. No softening language. Urgency without aggression — energized and punchy at every touchpoint.

### Neo-Brutalist Raw

- **Style ID:** `neo-brutalist-raw`
- **Description:** Punk graphic design — hard grid, zero radius, thick black borders, neon lime accent on white.
- **Typography:** Heading `Space Mono`, body `Archivo`. Space Mono bold for all headings — monospace rawness signals anti-polish intent; Archivo for body; all-caps headlines at oversized scale; never use tracking below normal.
- **Color direction:** primary #000000, secondary #ffffff, accent #a3e635, background #ffffff, text #000000
- **Layout DNA:** dense-grid; radius 0; density compact; shadow 4px 4px 0 #000
- **Materiality:** Thick solid 4px borders on pure white ground. Hard offset drop-shadows (4px offset, 0 blur, #000). Zero blur, zero gradients. Raw exposed structure — visible grid lines as design element.
- **Motion:** SPRING_SNAPPY — Hover: translateY(-2px) + shadow shrinks to 2px 2px 0 #000, step-start 50ms. Click: active:translate-x-[2px] active:translate-y-[2px] shadow:none. No easing — instant snap. No page-load animation.
- **Icons:** tabler (filled)
- **Best fit products:** Creative-Agency, Music, Streetwear
- **Avoid for:** Healthcare, Finance, Enterprise
- **Audience personas:** gen-z-creatives, design-rebels, streetwear-fans
- **Signature motifs:**
- thick 4px solid black borders on all containers
- hard offset box-shadow (4px 4px 0 #000) — zero blur
- oversized uppercase monospace headline as graphic element
- neon lime accent block on white background
- visible grid gap using borders (gap:0 + border on children)
- **Hero archetypes:**
- full-width bordered box: Space Mono headline + neon lime accent underline on white
- split hero: half black / half white with hard 4px border divider and lime CTA
- stacked text blocks alternating bg-white / bg-lime-400 fills with thick borders
- **WOW effects:**
- 4px offset hard drop-shadow on every card that snaps on hover
- pressed effect: active:translate-x-[2px] active:translate-y-[2px] with shadow collapse
- alternating bg-lime-400 / bg-white grid cells for maximum contrast rhythm
- oversized monospace headline at 20vw+ used as background texture layer
- **Surface recipes:**
- card: bg-white border-4 border-black shadow-[4px_4px_0_#000] rounded-none p-5
- accent block: bg-lime-400 border-4 border-black text-black uppercase font-black
- **Prompt-safe CSS cues:**
- border-4 border-black shadow-[4px_4px_0_#000]
- bg-white text-black rounded-none
- uppercase font-black tracking-wider
- grid grid-cols-3 gap-0 border-4 border-black
- bg-lime-400 hover:bg-lime-300 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all
- **Anti-patterns:**
- rounded corners of any size
- gradients of any kind
- glassmorphism or backdrop blur
- soft multi-layer shadows
- serif or friendly rounded fonts
- **Forbidden treatments:**
- border-radius beyond 0px
- CSS gradients or blur transitions
- more than 3 colors in the palette
- soft shadows or glow effects
- **Copy tone:** Blunt, direct, zero fluff. All-caps headlines acceptable. Short punchy sentences. No softening language. CTA: single imperative word (BUY / GET / START). Functional over charming.

### Season 04 Fashion

- **Style ID:** `season-04-fashion`
- **Description:** High-fashion brutalism — editorial typography meets raw structure, deconstructed luxury runway aesthetic.
- **Typography:** Heading `Bebas Neue`, body `Outfit`. Bebas Neue for headlines — full-caps, tight tracking, architectural scale at 12vw+; Outfit light for body; mix editorial letter-spacing (-0.05em) with full-caps labels (tracking-[0.3em]).
- **Color direction:** primary #1a1a1a, secondary #e5e5e5, accent #ec4899, background #fafafa, text #171717
- **Layout DNA:** asymmetric-scroll; radius 0; density balanced; shadow 3px 3px 0 #1a1a1a
- **Materiality:** Matte off-white with charcoal borders. Pink accent used sparingly — one element per section maximum. Deconstructed layout — intentional misalignment signals avant-garde editorial intent.
- **Motion:** CLIP_REVEAL — Clip-path text reveals on scroll enter. Staggered entrance — each element reveals 80ms after previous. Hover: scale(1.01) with 150ms ease-out. No spring physics — editorial restraint.
- **Icons:** heroicons (outlined)
- **Best fit products:** Fashion, Portfolio, Creative-Agency
- **Avoid for:** SaaS, Dashboard
- **Audience personas:** fashion-industry, creative-directors
- **Signature motifs:**
- Bebas Neue headline at 15vw+ running edge-to-edge across viewport
- single pink accent line or element per section — never two
- intentional asymmetric column break — one column narrower than expected
- ultra-thin 1px charcoal rule as section separator
- **Hero archetypes:**
- full-bleed Bebas Neue headline at 20vw with clip-path reveal on load
- asymmetric split: 70/30 column hero with oversized type left, sparse detail right
- **WOW effects:**
- clip-path diagonal wipe on hero text reveal — editorial magazine entrance
- pink accent line that grows from 0 to 100% width on section scroll-enter
- oversized Bebas Neue at 25vw as faint watermark behind content (opacity-5)
- **Surface recipes:**
- editorial card: bg-white border border-neutral-200 p-8 no-radius hover:border-neutral-800 transition-colors
- accent panel: border-l-2 border-l-pink-500 pl-6 bg-neutral-50 py-4
- **Prompt-safe CSS cues:**
- grid grid-cols-[2fr_1fr] gap-16 items-start max-w-7xl mx-auto px-8
- text-[15vw] font-normal leading-none tracking-tight text-neutral-900 uppercase
- border-b border-neutral-300 pb-2 text-xs uppercase tracking-[0.3em] text-neutral-500
- [clip-path:inset(0_100%_0_0)] animate-[reveal_0.6s_ease-out_forwards]
- bg-pink-500 h-px w-0 animate-[expand_0.4s_ease-out_0.3s_forwards]
- **Anti-patterns:**
- symmetrical equal-column grids
- rounded pill shapes or radius beyond 0px
- heavy multi-layer drop shadows
- playful or bouncy motion presets
- **Forbidden treatments:**
- more than one accent color per section
- soft gradients or glassmorphism
- heavy border weights over 1px on non-brutalist containers
- **Copy tone:** Editorial and confident. Sparse language. Fragment sentences acceptable. Fashion-forward vocabulary without pretension. Seasonal narrative language: Collection / Season / Chapter.

### Yellow Neo-Brutalist

- **Style ID:** `yellow-neo-brutalist`
- **Description:** Electric yellow on black brutalism — maximum contrast, hard shadows, construction-zone energy.
- **Typography:** Heading `JetBrains Mono`, body `Inter`. JetBrains Mono bold for all headings — monospace precision signals developer culture; Inter for body; headings always uppercase; extreme size contrast between heading and body required.
- **Color direction:** primary #facc15, secondary #000000, accent #eab308, background #000000, text #facc15
- **Layout DNA:** dense-grid; radius 0; density compact; shadow 4px 4px 0 #facc15
- **Materiality:** Pure black surfaces with electric yellow borders and shadows. Hard offset shadows in yellow instead of black. Terminal/construction aesthetic — zero decoration, maximum utility.
- **Motion:** SPRING_SNAPPY — Snap state changes — no easing. Hover: yellow shadow expands to 6px 6px 0. Click: element translates +2px +2px, shadow collapses to zero. Page load: elements appear in scan order, no stagger.
- **Icons:** tabler (filled)
- **Best fit products:** Developer-Tools, Startup, Creative-Agency
- **Avoid for:** Healthcare, Luxury
- **Audience personas:** developers, tech-founders
- **Signature motifs:**
- electric yellow borders and text on pure black — no mid-tones allowed
- monospace font at oversized scale as architectural grid element
- hard yellow offset shadows (4px 4px 0 #facc15)
- visible grid structure with yellow dividers on black
- **Hero archetypes:**
- all-black hero with massive JetBrains Mono headline in #facc15, single-column focus
- grid hero: alternating black/yellow cells each with bold monospace label
- **WOW effects:**
- yellow shadow glow on hover: hard offset + ambient glow(0 0 24px #facc1580)
- construction-zone alternating black/yellow stripe pattern as section divider
- massive monospace number counter at 20vw as background typography element
- **Surface recipes:**
- card: bg-black border-2 border-yellow-400 shadow-[4px_4px_0_#facc15] text-yellow-400 p-5
- accent stripe: bg-yellow-400 text-black font-black uppercase tracking-widest border-y-2 border-black
- **Prompt-safe CSS cues:**
- bg-black text-yellow-400 border-2 border-yellow-400 shadow-[4px_4px_0_#facc15]
- font-mono font-bold uppercase tracking-widest text-yellow-300
- grid grid-cols-2 gap-0 [&>*]:border border-yellow-400/50
- bg-yellow-400 text-black font-black uppercase rounded-none px-6 py-3
- hover:shadow-[6px_6px_0_#facc15] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-none
- **Anti-patterns:**
- warm or pastel color palettes
- rounded corners or friendly shapes
- serif or display-editorial fonts
- soft gradients or color fades
- **Forbidden treatments:**
- any color other than black, yellow, and white accents
- border-radius beyond 0px
- glassmorphism or blur effects
- smooth transition easing — snap only
- **Copy tone:** Developer-direct, terse, precise. Technical terminology welcomed. Imperative calls to action. No marketing fluff — functional documentation tone with attitude.


## Dark Luxury

**When to reach for this category:** Fintech, Dashboard, Crypto, AI, Premium-SaaS, Luxury-Tech, Film, Portfolio, Creative-Agency, Creative, Luxury, Entertainment, Nightlife.

### Dark Elite Frosted

- **Style ID:** `dark-elite-frosted`
- **Description:** Elite dark frosted glass panels over OLED black — specular highlights, ultra-thin borders, premium fintech feel.
- **Typography:** Heading `General Sans`, body `Inter`. General Sans semibold for headings — clean geometric without sterility; Inter for data/body; tabular-nums for all numeric displays; avoid heading weights above 600 for restraint.
- **Color direction:** primary #e2e8f0, secondary #64748b, accent #22d3ee, background #020617, text #e2e8f0
- **Layout DNA:** bento-grid; radius 16px; density compact; shadow 0 8px 32px rgba(0,0,0,0.4), inset 0 1px rgba(255,255,255,0.08)
- **Materiality:** OLED black base with frosted glass panels (backdrop-blur-xl). Specular top highlight: inset 0 1px rgba(255,255,255,0.08). Cyan accent for interactive states and key metrics only.
- **Motion:** SCALE_IN — Cards scale from 0.96 to 1.0 in 200ms ease-out. Stagger bento cells 40ms each. Hover: border-color shifts to cyan/30. No spring physics — precise fintech timing only.
- **Icons:** lucide (outlined)
- **Best fit products:** Fintech, Dashboard, Crypto
- **Avoid for:** Education, Healthcare
- **Audience personas:** finance-professionals, crypto-traders
- **Signature motifs:**
- frosted glass card with inset specular highlight on top edge
- ultra-thin 1px border at rgba(255,255,255,0.08) — barely visible
- cyan accent used exclusively for active states and key metrics
- tabular monospace numbers in accent color on dark surface
- **Hero archetypes:**
- bento dashboard hero: asymmetric grid with featured large KPI card top-left
- centered glass card hero on pure OLED black with single cyan metric highlighted
- **WOW effects:**
- glass panel shimmer: pseudo-element diagonal highlight that moves on hover
- cyan ambient glow on key metric: shadow-[0_0_24px_-4px_#22d3ee80]
- scale-in stagger on bento grid load — cells enter in reading order 40ms apart
- **Surface recipes:**
- glass card: bg-white/[0.06] border border-white/[0.08] rounded-2xl backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_rgba(255,255,255,0.08)]
- metric cell: bg-white/[0.04] border border-cyan-500/20 rounded-xl p-4
- **Prompt-safe CSS cues:**
- bg-[#020617] text-slate-200 min-h-screen
- bg-white/[0.06] border border-white/[0.08] rounded-2xl backdrop-blur-xl p-5
- text-3xl font-semibold tabular-nums text-cyan-400
- border border-cyan-500/20 shadow-[0_0_24px_-4px_rgba(34,211,238,0.3)]
- grid grid-cols-4 gap-3 p-4
- **Anti-patterns:**
- light or warm backgrounds
- heavy saturated accent colors
- zero-radius sharp corners
- bold typography above 700 weight
- **Forbidden treatments:**
- any background lighter than #0f172a
- more than one accent color per view
- hard drop shadows without inset specular companion
- **Copy tone:** Professional and precise. Finance-grade clarity — numbers lead. Short descriptive labels. Confidence without hyperbole. CTA: action verbs only (Connect / Analyze / Trade).

### Gold on Black AI

- **Style ID:** `gold-on-black-ai`
- **Description:** Regal gold accents on true black — premium AI/tech luxury with restrained metallic highlights.
- **Typography:** Heading `Cormorant Garamond`, body `Sora`. Cormorant Garamond for display headings — use italic variant for elegance, generous tracking; Sora for UI/body at light weight; headings breathe with whitespace; avoid weights above 700.
- **Color direction:** primary #fbbf24, secondary #92400e, accent #f59e0b, background #09090b, text #fafaf9
- **Layout DNA:** centered-cinematic; radius 8px; density spacious; shadow 0 0 48px -8px rgba(251,191,36,0.15)
- **Materiality:** Near-black surfaces (#09090b) with restrained gold accents. Thin 1px gold/20 borders. Metallic gold used only for primary text emphasis and single CTA — never as fill on large surfaces.
- **Motion:** CLIP_REVEAL — Slow deliberate reveals: clip-path expands in 800ms cubic-bezier(0.25, 0.46, 0.45, 0.94). Gold underlines grow from center on hover in 300ms. Stagger: 150ms between paragraphs.
- **Icons:** material-symbols (two-tone)
- **Best fit products:** AI, Premium-SaaS, Luxury-Tech
- **Avoid for:** Education, Healthcare
- **Audience personas:** enterprise-buyers, tech-executives, luxury-consumers
- **Signature motifs:**
- gold text on near-black — one highlight element per section maximum
- thin 1px gold/20 horizontal rule as premium divider
- Cormorant italic headline with generous letter-spacing (-0.02em)
- gold ambient glow halo on primary CTA button
- **Hero archetypes:**
- full-bleed near-black hero with italic Cormorant headline at 72px centered, gold accent rule below
- split cinematic: text-only left panel with gold headline, right panel with gold-tinted visual
- **WOW effects:**
- gold ambient glow on hero: radial gradient from rgba(251,191,36,0.10) at center fading outward
- metallic shimmer on CTA button: diagonal pseudo-element highlight sweeps left-to-right on hover
- italic Cormorant at 120px+ behind content as atmospheric typographic layer (opacity-4)
- **Surface recipes:**
- card: bg-[#111113] border border-amber-500/20 rounded-lg shadow-[0_0_48px_-8px_rgba(251,191,36,0.15)]
- gold rule: h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent
- **Prompt-safe CSS cues:**
- bg-[#09090b] text-stone-50 min-h-screen
- text-6xl font-light italic tracking-tight text-amber-400
- border border-amber-500/20 rounded-lg bg-zinc-950 p-8
- shadow-[0_0_48px_-8px_rgba(251,191,36,0.15)] hover:shadow-[0_0_60px_-4px_rgba(251,191,36,0.25)] transition-shadow
- bg-amber-400 text-zinc-950 font-semibold rounded px-8 py-3 hover:bg-amber-300 transition-colors
- **Anti-patterns:**
- bright white backgrounds or light mode
- multiple warm accent colors competing with gold
- heavy bold type that visually overwhelms the layout
- playful or rounded design elements
- **Forbidden treatments:**
- gold fills on large surface areas — gold as ink highlight only
- neon or cool accent colors alongside gold
- hard brutalist shadow patterns
- **Copy tone:** Elevated and authoritative. Measured phrasing — no hype. Sophisticated vocabulary. Long-form comfortable. CTAs are polished imperatives: Discover / Access / Explore.

### Immersive Cinematic

- **Style ID:** `immersive-cinematic`
- **Description:** Full-viewport cinematic experience with 21:9 section aspect ratios — film-grade visual storytelling.
- **Typography:** Heading `Unbounded`, body `DM Sans`. Unbounded black for display headings — wide letterforms fill viewport edge-to-edge; DM Sans light for body; headings scale with viewport: clamp(3rem, 8vw, 8rem); no condensed widths.
- **Color direction:** primary #f0f0f0, secondary #525252, accent #7c3aed, background #0c0c0c, text #ededed
- **Layout DNA:** full-bleed-hero; radius 0; density spacious; shadow none
- **Materiality:** Near-black (#0c0c0c) with no competing texture. Violet accent exclusively for interactive emphasis. Content breathes with aggressive whitespace. Film-grade negative space as structure.
- **Motion:** CLIP_REVEAL — Cinematic entrances: clip-path expand from 0 in 900ms cubic-bezier(0.76, 0, 0.24, 1). Full-section parallax at 0.4× scroll rate. Stagger 200ms between hero lines. Violet accent line sweeps in last.
- **Icons:** material-symbols (sharp)
- **Best fit products:** Film, Portfolio, Creative-Agency
- **Avoid for:** E-commerce, Dashboard
- **Audience personas:** filmmakers, creative-directors, portfolio-owners
- **Signature motifs:**
- 21:9 aspect-ratio section as cinematic frame for visual storytelling
- Unbounded headline at full viewport width — zero margin, edge to edge
- single violet accent element as scene focal marker
- deep negative space used structurally — deliberate emptiness as design element
- **Hero archetypes:**
- full-viewport 21:9 section with Unbounded headline at bottom-left, violet underline accent
- split-scene: two 21:9 sections stacked — dark left text panel, right visual — fade boundary
- **WOW effects:**
- viewport-edge Unbounded headline clips in with cinematic curtain reveal (900ms)
- violet radial pulse on hero focal point: 0 0 80px 20px rgba(124,58,237,0.08)
- full-section parallax: background moves at 0.4× scroll speed creating depth
- **Surface recipes:**
- cinematic section: aspect-[21/9] w-full overflow-hidden bg-[#0c0c0c] relative
- scene text overlay: absolute bottom-12 left-12 text-neutral-100 max-w-2xl
- **Prompt-safe CSS cues:**
- bg-[#0c0c0c] text-neutral-100 min-h-screen
- aspect-[21/9] w-full overflow-hidden relative bg-[#161616]
- text-[clamp(3rem,8vw,8rem)] font-black leading-none tracking-tight text-neutral-50
- border-b border-neutral-800 absolute bottom-0 left-0 right-0
- text-violet-400 font-medium text-sm tracking-[0.2em] uppercase
- **Anti-patterns:**
- light backgrounds or reversed color themes
- busy multi-column content grids
- rounded corner or pill-shaped elements
- small-detail card-heavy layouts
- **Forbidden treatments:**
- any background lighter than #1a1a1a
- border-radius beyond 0px on section containers
- competing colors alongside violet — mono-accent rule enforced
- **Copy tone:** Cinematic and unhurried. Let visuals carry the narrative. Text as caption, not description. Short declarative sentences. Scene-setting language. CTA as transition: Continue / Play / Explore.

### Noir Cinema

- **Style ID:** `noir-cinema`
- **Description:** Dramatic dark cinematics — deep blacks, clip-path reveals, bold display typography, single-column focus.
- **Typography:** Heading `Syne`, body `Outfit`. Syne extrabold for display headings — uppercase, tight tracking (-0.04em); Outfit light for body — generous line-height (1.7); white-on-black maximum contrast; never reduce heading weight below 700.
- **Color direction:** primary #ffffff, secondary #404040, accent #8b5cf6, background #000000, text #ffffff
- **Layout DNA:** centered-cinematic; radius 0; density spacious; shadow none
- **Materiality:** Pure black ground. Minimal white text. Violet accent reserved for single focal element per section. No textures, no gradients — cinema black is absolute.
- **Motion:** CLIP_REVEAL — Clip-path reveals left-to-right on scroll enter in 600ms ease-out. Stagger 100ms between lines. No hover effects on text — motion reserved exclusively for scroll reveals.
- **Icons:** material-symbols (filled)
- **Best fit products:** Creative, Luxury, Film, Portfolio
- **Avoid for:** Healthcare, Education
- **Audience personas:** filmmakers, luxury-brand-directors, portfolio-creatives
- **Signature motifs:**
- full-viewport black section with single white headline at optical centre
- hairline white/10 border as the only surface delimiter
- small-caps tracking-[0.3em] metadata labels in white/60
- horizontal white/20 gradient rule as section separator
- **Hero archetypes:**
- full-screen black hero with Syne 80px+ headline centered, clip-path reveal on load
- cinematic letterbox: 21:9 aspect-ratio section with text at bottom-left optical anchor
- **WOW effects:**
- clip-path rectangular wipe from left — headline appears word by word in sequence
- single violet accent element that pulses with subtle 0.4s opacity cycle
- ultra-slow scroll parallax: background text moves at 0.3× scroll rate
- **Surface recipes:**
- panel: bg-black border border-white/10 p-px — near-invisible outline only
- highlight card: bg-white/5 border border-white/10 p-6 rounded-none
- **Prompt-safe CSS cues:**
- bg-black text-white min-h-screen flex items-center justify-center
- text-7xl font-black uppercase tracking-tighter leading-none
- border border-white/10 p-px rounded-none
- opacity-60 text-xs tracking-[0.3em] uppercase text-gray-400
- w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-12
- **Anti-patterns:**
- light or off-white backgrounds
- rounded pill shapes or soft corners
- pastel or warm color palette
- busy multi-column content grids
- **Forbidden treatments:**
- any background lighter than #111111
- border-radius beyond 0px
- drop shadows or glow effects on text
- more than two accent colors per view
- **Copy tone:** Cinematic and sparse. Every word earns its place. Declarative statements. No exclamation marks. Rhythm through line breaks. Single-word CTAs: WATCH / ENTER / BEGIN.

### Red Noir

- **Style ID:** `red-noir`
- **Description:** Crimson-on-black cinema noir — seductive dark contrast with blood-red accent on velvet-black surfaces.
- **Typography:** Heading `Libre Bodoni`, body `Work Sans`. Libre Bodoni for display — serif gravitas with italic options; Work Sans regular/light for body; headings in white or crimson; body always off-white; never reduce contrast below 7:1.
- **Color direction:** primary #dc2626, secondary #4a0404, accent #ef4444, background #0a0a0a, text #fafafa
- **Layout DNA:** full-bleed-hero; radius 4px; density balanced; shadow 0 20px 60px -10px rgba(220,38,38,0.2)
- **Materiality:** Velvet black ground. Crimson accents as blood-ink highlights. Thin 1px crimson/20 borders. Red ambient glow on focal elements. Texture through typography weight contrast only.
- **Motion:** CLIP_REVEAL — Dramatic slow reveals: clip-path from bottom in 700ms ease-out. Red accent lines sweep across in 400ms. Hover: text turns crimson in 200ms ease. Stagger: 120ms between sections.
- **Icons:** lucide (filled)
- **Best fit products:** Entertainment, Nightlife, Luxury
- **Avoid for:** SaaS, Healthcare
- **Audience personas:** entertainment-industry, luxury-consumers, nightlife-professionals
- **Signature motifs:**
- crimson accent on white text — single word or phrase highlighted per section
- thin 1px red/20 border on dark surface cards
- serif italic headline in near-white with crimson underline accent
- red ambient glow halo behind featured imagery or focal point
- **Hero archetypes:**
- full-bleed velvet-black hero with Libre Bodoni italic headline in white, single crimson word emphasis
- cinematic 21:9 section with photography overlay and red/black gradient bottom fade
- **WOW effects:**
- crimson word reveal: individual words enter with clip-path stagger 80ms apart
- red radial glow on hero: rgba(220,38,38,0.12) radial gradient behind focal point
- serif italic at 10vw+ as atmospheric background layer at opacity-5
- **Surface recipes:**
- card: bg-[#0f0f0f] border border-red-800/30 rounded p-6 hover:border-red-600/50 transition-colors
- crimson accent rule: h-px w-full bg-gradient-to-r from-transparent via-red-600/50 to-transparent
- **Prompt-safe CSS cues:**
- bg-[#0a0a0a] text-zinc-50 min-h-screen
- text-6xl font-bold italic tracking-tight text-white leading-none
- border border-red-800/30 rounded bg-zinc-950/80 p-6 hover:border-red-500/50 transition-colors
- text-red-500 font-semibold
- shadow-[0_20px_60px_-10px_rgba(220,38,38,0.2)] hover:shadow-[0_20px_60px_-4px_rgba(220,38,38,0.3)] transition-shadow
- **Anti-patterns:**
- light or warm backgrounds
- multiple competing accent colors
- playful rounded shapes or pill buttons
- bright saturated palettes outside crimson range
- **Forbidden treatments:**
- crimson fills on large surface areas — accent as highlight only
- warm or orange tones that shift crimson toward orange-red
- heavy hard shadows without ambient glow pairing
- **Copy tone:** Evocative and seductive. Short, impactful lines. Mystery and tension through word choice. Sensory language. CTAs are invitations: Enter / Experience / Descend.


## Glassmorphism

**When to reach for this category:** Premium-SaaS, Music, Social, Gaming, Developer-Tools, Crypto, Weather, Meditation, Analytics.

### Glass Aurora

- **Style ID:** `glass-aurora`
- **Description:** Ethereal premium glassmorphism — layered frosted panels over aurora gradient background.
- **Typography:** Heading `Sora`, body `Inter`. Sora for all headings; Inter for body text; avoid serif; keep letter-spacing tight on large sizes.
- **Color direction:** primary #e0e7ff, secondary #c7d2fe, accent #a78bfa, background #1e1b4b, text #e0e7ff
- **Layout DNA:** centered-floating; radius 16px; density balanced; shadow 0 8px 32px rgba(0,0,0,0.4), inset 0 1px rgba(255,255,255,0.2)
- **Materiality:** Frosted glass — bg-white/10 backdrop-blur-xl; aurora blobs are absolute rounded-full blur-3xl; layered depth through stacked opacity panels.
- **Motion:** SCALE_IN — Cards scale-in from 0.95 on load; blobs drift with slow CSS translate animations; hover lifts card with subtle scale(1.02).
- **Icons:** phosphor (rounded)
- **Best fit products:** Premium-SaaS, Music, Social
- **Avoid for:** Enterprise, Healthcare
- **Audience personas:** young-professionals, design-enthusiasts
- **Signature motifs:**
- Aurora gradient blob visible through frosted panel
- Translucent border with white/20 opacity
- Inset highlight shadow on glass surface
- Layered depth via stacked glass panels
- **Hero archetypes:**
- Centered floating card over aurora gradient backdrop
- Full-viewport gradient with frosted modal overlay
- **WOW effects:**
- Animated aurora blobs drifting slowly behind glass panels
- Backdrop-blur with chromatic inset glow on hover
- Multi-layer glass depth — near/mid/far panels
- **Surface recipes:**
- bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8
- relative overflow-hidden bg-gradient-to-br from-violet-950 via-indigo-900 to-sky-900
- **Prompt-safe CSS cues:**
- relative overflow-hidden bg-gradient-to-br from-violet-950 via-indigo-900 to-sky-900 min-h-screen
- absolute w-96 h-96 rounded-full blur-3xl opacity-40 pointer-events-none
- bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8
- text-white font-semibold text-xl
- shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_rgba(255,255,255,0.2)]
- **Anti-patterns:**
- White or light backgrounds — kills the glass depth
- No blur effect — glass without blur is just opacity
- Warm earth tones — clashes with cool aurora palette
- Harsh solid borders — use white/20 translucent instead
- **Forbidden treatments:**
- Opaque solid-color panels with no transparency
- Serif typography — breaks the futuristic tone
- Dense data grids — glass is for hero moments, not dashboards
- **Copy tone:** Premium and aspirational — evocative words, minimal text, elegant spacing.

### Obsidian Lime

- **Style ID:** `obsidian-lime`
- **Description:** Dark obsidian glass with electric lime accents — neon glow through frosted dark panels.
- **Typography:** Heading `Space Grotesk`, body `Inter`. Space Grotesk for headings with tight tracking; Inter for body; mono stack for code snippets.
- **Color direction:** primary #a3e635, secondary #bef264, accent #84cc16, background #0c0a09, text #e7e5e4
- **Layout DNA:** bento-grid; radius 20px; density compact; shadow 0 0 24px -4px rgba(132,204,22,0.40), 0 4px 16px rgba(0,0,0,0.60)
- **Materiality:** Dark glass over pure obsidian — bg-black/80 backdrop-blur-lg; lime neon border glow; inset highlights create depth against near-black surface.
- **Motion:** SCALE_IN — Panels scale-in sharp on load; lime glow pulses on hover; active states compress card with scale(0.98).
- **Icons:** lucide (outlined)
- **Best fit products:** Gaming, Developer-Tools, Crypto
- **Avoid for:** Healthcare, Education
- **Audience personas:** gamers, developers
- **Signature motifs:**
- Electric lime border glow cutting through dark glass
- Bento grid cells with varying opacity dark panels
- Monospace accent labels in lime against black
- Neon pulse animation on active/hover states
- **Hero archetypes:**
- Dark bento grid with lime-accented metric cards
- Full-screen obsidian backdrop with floating glass HUD
- **WOW effects:**
- Lime neon glow bleeding through frosted dark panel edges
- Bento cells breathing with staggered scale animations
- Scanline shimmer on active data panels
- **Surface recipes:**
- bg-black/80 backdrop-blur-lg border border-lime-500/20 rounded-[20px] p-5
- bg-stone-950 shadow-[0_0_24px_-4px_rgba(132,204,22,0.40)]
- **Prompt-safe CSS cues:**
- bg-stone-950 min-h-screen text-stone-200
- grid grid-cols-3 gap-3 p-4
- bg-black/80 backdrop-blur-lg border border-lime-500/20 rounded-[20px] p-5
- text-lime-400 font-bold tabular-nums text-2xl
- shadow-[0_0_24px_-4px_rgba(132,204,22,0.40),inset_0_1px_rgba(255,255,255,0.06)]
- **Anti-patterns:**
- Light or white backgrounds — destroys the obsidian depth
- Pastel colors — electric lime demands high saturation
- Serif fonts — breaks the digital-precision aesthetic
- Heavy decorative drop shadows in warm tones
- Centered single-column layouts — bento grid is the signature
- **Forbidden treatments:**
- Warm amber or earth-tone accents — clash with lime neon
- Rounded pill buttons beyond 9999px — keep geometric
- Semi-opaque white overlays — surface must stay dark glass
- **Copy tone:** Direct and technical — short punchy labels, imperative verbs, hacker aesthetic.

### Slate Atmospheric

- **Style ID:** `slate-atmospheric`
- **Description:** Soft slate-toned glassmorphism with atmospheric depth — muted blue-gray panels on misty gradient.
- **Typography:** Heading `Plus Jakarta Sans`, body `Inter`. Plus Jakarta Sans for headings with medium weight; Inter for body; generous line-height for legibility on dark glass.
- **Color direction:** primary #94a3b8, secondary #64748b, accent #38bdf8, background #0f172a, text #cbd5e1
- **Layout DNA:** floating-cards; radius 24px; density spacious; shadow 0 4px 40px rgba(0,0,0,0.35), inset 0 1px rgba(148,163,184,0.12)
- **Materiality:** Atmospheric glass — panels carry muted slate tint with backdrop-blur-2xl; sky accent creates focal depth; generous padding breathes between elements.
- **Motion:** FADE_UP — Cards fade-up with staggered delay; hover gently lifts with translateY(-2px); no bounce — calm and atmospheric throughout.
- **Icons:** heroicons (outlined)
- **Best fit products:** Weather, Meditation, Analytics
- **Avoid for:** E-commerce, Entertainment
- **Audience personas:** professionals, wellness-seekers
- **Signature motifs:**
- Muted slate glass panels floating on deep navy gradient
- Sky-blue accent highlighting data points and CTAs
- Wide padding creating breathing room between panels
- Subtle misty depth from layered background gradient
- Soft atmospheric glow behind primary card
- **Hero archetypes:**
- Floating card grid over deep navy-to-indigo gradient
- Centered hero with misty glass modal on atmospheric backdrop
- **WOW effects:**
- Staggered floating cards emerging from mist on page load
- Sky-blue glow radiating behind focal card element
- Backdrop-blur depth shift as panels layer over gradient
- Smooth atmospheric parallax on scroll
- **Surface recipes:**
- bg-slate-900/60 backdrop-blur-2xl border border-slate-400/15 rounded-[24px] p-8
- bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900 min-h-screen
- **Prompt-safe CSS cues:**
- bg-gradient-to-br from-slate-900 via-sky-950/50 to-slate-900 min-h-screen p-8
- flex flex-wrap gap-6 justify-center
- bg-slate-800/60 backdrop-blur-2xl border border-slate-400/15 rounded-[24px] p-8
- text-sky-400 font-semibold text-lg
- shadow-[0_4px_40px_rgba(0,0,0,0.35),inset_0_1px_rgba(148,163,184,0.12)]
- **Anti-patterns:**
- High-saturation neon accents — too aggressive for atmospheric calm
- Zero-padding dense grids — spaciousness is the aesthetic signature
- Warm beige or amber backgrounds — misty blue tones are essential
- Harsh opaque panel borders — must stay translucent
- **Forbidden treatments:**
- Pure black backgrounds — slate-navy gradient is required for atmosphere
- Rounded pill buttons — geometric rounded-2xl maintains the tone
- Bold uppercase monospace labels — breaks the refined professional feel
- **Copy tone:** Calm and informative — measured tone, clarity over cleverness, professional serenity.


## Industrial

**When to reach for this category:** Developer-Tools, IDE, Documentation, Architecture, Real-Estate, Construction, Manufacturing, Infrastructure.

### Browser Workspace

- **Style ID:** `browser-workspace`
- **Description:** Browser-chrome inspired workspace with tab bars, address bars, and window controls — digital tool aesthetic.
- **Typography:** Heading `Inter`, body `JetBrains Mono`. Inter for UI labels and headings; JetBrains Mono for code, paths, and data; system-style sizing matching OS chrome.
- **Color direction:** primary #171717, secondary #404040, accent #3b82f6, background #262626, text #e5e5e5
- **Layout DNA:** sticky-sidebar; radius 8px; density compact; shadow 0 1px 0 rgba(0,0,0,0.40)
- **Materiality:** Browser chrome — tab bar header, address input, sidebar navigation; monochrome neutral surfaces with blue accent for active/focus states.
- **Motion:** FADE_UP — System-speed transitions at 150ms; no spring or bounce; tabs slide in linearly; focus rings appear instantly.
- **Icons:** lucide (outlined)
- **Best fit products:** Developer-Tools, IDE, Documentation
- **Avoid for:** Fashion, Food
- **Audience personas:** developers, technical-users
- **Signature motifs:**
- Tab bar with rounded-top active tab and separator lines
- Address bar with URL monospace input styling
- Window traffic-light control dots (close/minimize/maximize)
- Sidebar with icon + label nav items at compact density
- **Hero archetypes:**
- Full app shell with tab bar, sidebar, and main content area
- Modal dialog styled as browser popup with title bar
- **WOW effects:**
- Tab open animation with slide-right entrance
- Address bar focus bloom with blue outline glow
- Sidebar collapse with smooth width transition
- **Surface recipes:**
- bg-neutral-900 border-b border-neutral-700 flex items-center gap-1 px-3 h-10
- bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 font-mono text-sm
- **Prompt-safe CSS cues:**
- bg-neutral-800 text-neutral-200 h-screen flex flex-col overflow-hidden
- flex h-9 bg-neutral-900 border-b border-neutral-700 items-end gap-0
- w-56 border-r border-neutral-700 flex-shrink-0 bg-neutral-900 flex flex-col
- font-mono text-sm text-neutral-300 bg-neutral-800 border border-neutral-600 rounded-md px-3 py-1
- text-blue-400 font-medium text-sm border-b-2 border-blue-500 pb-1
- **Anti-patterns:**
- Decorative gradients — flat neutral chrome only
- Rounded corners beyond 10px — browser chrome uses modest radius
- Warm or earthy color palette — strictly neutral with blue accent
- Glassmorphism blur — opaque surfaces mimic native OS chrome
- **Forbidden treatments:**
- Colorful sidebar backgrounds — dark neutral only
- Large display typography — system UI uses small functional text
- Spring bounce animations — system chrome is instant and linear
- **Copy tone:** Functional and precise — no marketing language; labels match the OS chrome convention; minimal copy.

### Industrial Chic

- **Style ID:** `industrial-chic`
- **Description:** Refined industrial with concrete textures and copper accents — warehouse-loft sophistication.
- **Typography:** Heading `Barlow`, body `Source Sans 3`. Barlow Condensed for oversized display headings; Source Sans 3 for readable body; modest tracking on labels.
- **Color direction:** primary #78716c, secondary #a8a29e, accent #d97706, background #f5f5f4, text #292524
- **Layout DNA:** split-hero; radius 4px; density balanced; shadow 0 2px 8px rgba(41,37,36,0.12)
- **Materiality:** Concrete and copper — light stone surface bg-stone-100; copper accent borders; raw 4px radius preserves industrial roughness.
- **Motion:** FADE_UP — Restrained fade-up transitions; no bouncing; hover shifts copper accent shadow slightly right; deliberate and architectural.
- **Icons:** tabler (outlined)
- **Best fit products:** Architecture, Real-Estate, Construction
- **Avoid for:** Healthcare, Education
- **Audience personas:** architects, urban-professionals
- **Signature motifs:**
- Concrete-toned surface with copper accent hairlines
- Oversized Barlow Condensed display heading
- Split layout dividing image texture from content
- Minimal decoration — structure as ornament
- **Hero archetypes:**
- Full-bleed concrete texture left panel with copper-accented copy right
- Oversized industrial display type on light stone background
- **WOW effects:**
- Concrete texture subtle grain overlay on surface panels
- Copper accent line animates in from left on section entry
- Display heading scales slightly on scroll for parallax gravitas
- **Surface recipes:**
- bg-stone-100 border border-stone-300 rounded-[4px] p-6
- border-l-4 border-amber-600 pl-6 bg-stone-50
- **Prompt-safe CSS cues:**
- bg-stone-100 text-stone-900 min-h-screen
- grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-screen
- bg-stone-200 border border-stone-300 rounded-[4px] p-6
- text-amber-700 font-semibold uppercase tracking-wider text-sm
- shadow-[0_2px_8px_rgba(41,37,36,0.12)] hover:shadow-[0_4px_16px_rgba(41,37,36,0.18)]
- **Anti-patterns:**
- Pure white background — stone warmth is essential
- Rounded corners beyond 6px — raw edge is the signature
- Bright neon accents — copper warmth only
- Dark moody backgrounds — industrial chic is light and refined
- Gradient blobs or glassmorphism — concrete is opaque
- **Forbidden treatments:**
- Black background with neon accents — that is industrial disruptor territory
- Monospace body text — refined industrial uses humanist sans
- Heavy drop shadows with color tint — gray or none only
- **Copy tone:** Confident and architectural — clean declarative sentences; substance over style; professional authority.

### Industrial Disruptor

- **Style ID:** `industrial-disruptor`
- **Description:** Raw industrial with exposed structure and monospace details — factory-floor aesthetics meets digital precision.
- **Typography:** Heading `IBM Plex Mono`, body `IBM Plex Sans`. IBM Plex Mono for all headings and labels; IBM Plex Sans for body text; uppercase tracking on section markers.
- **Color direction:** primary #f97316, secondary #ea580c, accent #fb923c, background #18181b, text #d4d4d8
- **Layout DNA:** dense-grid; radius 2px; density compact; shadow 2px 2px 0 rgba(249,115,22,0.60)
- **Materiality:** Exposed zinc grid — sharp 2px borders, no rounding; raw zinc surface with orange accent cuts; monospace type reinforces machine precision.
- **Motion:** SPRING_SNAPPY — Snappy 200ms transitions; hover adds orange offset shadow; click triggers hard scale(0.97) compression.
- **Icons:** material-symbols (sharp)
- **Best fit products:** Manufacturing, Developer-Tools, Infrastructure
- **Avoid for:** Fashion, Luxury
- **Audience personas:** engineers, ops-teams
- **Signature motifs:**
- Hard 2px border grid with orange accent lines
- Monospace status labels in uppercase tracking
- Orange offset drop shadow on interactive elements
- Exposed structure with visible grid infrastructure
- Industrial diagonal hatch pattern as surface texture
- **Hero archetypes:**
- Full-width dense bento grid with metric blocks and orange accents
- Split layout: left dark panel with stats, right orange-accent hero
- **WOW effects:**
- Orange border-shadow pulse on data update
- Monospace number counter animation on metric cards
- Grid lines animate in on page load creating scaffold effect
- **Surface recipes:**
- bg-zinc-900 border border-zinc-700 rounded-[2px] p-4
- border-l-4 border-orange-500 pl-4 bg-zinc-800
- **Prompt-safe CSS cues:**
- bg-zinc-950 text-zinc-300 font-mono min-h-screen
- grid grid-cols-4 gap-[2px] bg-zinc-800
- bg-zinc-900 border border-zinc-700 p-4 rounded-[2px]
- text-orange-400 font-bold uppercase tracking-widest text-xs
- shadow-[2px_2px_0_rgba(249,115,22,0.60)] hover:shadow-[3px_3px_0_rgba(249,115,22,0.80)]
- **Anti-patterns:**
- Rounded corners beyond 4px — raw edges are the aesthetic
- Pastel or soft color palette — orange and zinc only
- Decorative gradients — exposed structure forbids ornamentation
- Soft drop shadows — only hard offset shadows allowed
- Sans-serif body as primary — mono reinforces factory precision
- **Forbidden treatments:**
- Glassmorphism or blur effects — zero transparency layers
- Animated blobs or organic shapes — all geometry is rigid
- Centered single-column hero — density is mandatory
- **Copy tone:** Terse and technical — numbers, specs, and imperatives; zero fluff; machine-room directness.


## Playful

**When to reach for this category:** Education, E-commerce, Kids, Social, Healthcare, Wellness, Games, Creative.

### Playful Pop

- **Style ID:** `playful-pop`
- **Description:** Fun bouncy energy with saturated pastels, rounded shapes, spring physics.
- **Typography:** Heading `Quicksand`, body `Nunito`. Quicksand bold for headings; Nunito for body with generous line-height; avoid monospace or serif entirely.
- **Color direction:** primary #7c3aed, secondary #8b5cf6, accent #a78bfa, background #f5f3ff, text #4c1d95
- **Layout DNA:** centered-hero; radius 24px; density balanced; shadow 0 8px 24px rgba(124,58,237,0.25)
- **Materiality:** Soft violet pastels — white cards on violet-50 background; rounded-3xl everywhere; drop shadow with violet tint creates pop-up sticker effect.
- **Motion:** SPRING_BOUNCY — All entrances spring-bouncy; buttons scale to 1.05 on hover with drop shadow growth; click compresses to scale(0.95); staggered card entrance.
- **Icons:** phosphor (rounded)
- **Best fit products:** Education, E-commerce, Kids, Social
- **Avoid for:** Enterprise, Fintech
- **Audience personas:** young-users, parents, educators
- **Signature motifs:**
- Oversized rounded pill button with colored drop shadow
- White card on pastel background with violet border accent
- Large playful heading with bold weight and tight line-height
- Grid of rounded cards with staggered bounce entrance
- **Hero archetypes:**
- Centered hero with oversized rounded CTA button and playful headline
- Grid of rounded feature cards on pastel background
- **WOW effects:**
- Staggered spring-bounce card entrance on page load
- Button hover: shadow expands + slight scale with spring easing
- Confetti scatter animation on key user action completion
- **Surface recipes:**
- bg-white rounded-3xl p-6 shadow-[0_8px_24px_rgba(124,58,237,0.20)] border border-violet-100
- bg-violet-50 min-h-screen p-8
- **Prompt-safe CSS cues:**
- bg-violet-50 min-h-screen
- rounded-3xl px-10 py-5 bg-violet-500 text-white font-bold text-lg shadow-lg hover:shadow-xl
- grid grid-cols-2 md:grid-cols-3 gap-4 p-6
- bg-white rounded-2xl p-5 shadow-md border border-violet-100
- text-violet-600 font-extrabold text-5xl text-center leading-none
- **Anti-patterns:**
- Dark color scheme — violet pastel background is the foundation
- Hairline borders — rounded bold cards only
- Monospace fonts — playful excludes machine aesthetics
- Grid-dense data layouts — this is not a dashboard
- **Forbidden treatments:**
- Glassmorphism blur panels — opaque white cards only
- Sharp corners or 0-radius — roundedness is non-negotiable
- Muted earth tones — saturation must stay high
- **Copy tone:** Warm and encouraging — exclamation-friendly, active verbs, celebration of user actions.

### Soft Pastel Wellness

- **Style ID:** `soft-pastel-wellness`
- **Description:** Airy pastel floating cards with soft multi-layer shadows — approachable and gentle wellness aesthetic.
- **Typography:** Heading `Comfortaa`, body `Nunito Sans`. Comfortaa for headings at generous size; Nunito Sans for body with 1.7 line-height; avoid tight letter spacing.
- **Color direction:** primary #7dd3fc, secondary #bae6fd, accent #86efac, background #f0f9ff, text #334155
- **Layout DNA:** floating-cards; radius 28px; density spacious; shadow 0 4px 32px rgba(125,211,252,0.20), 0 1px 8px rgba(0,0,0,0.04)
- **Materiality:** Gentle cloud floating — white cards on sky-50 with soft multi-layer shadows; no hard borders; pastel tinted background creates airy depth.
- **Motion:** SPRING_SOFT — Gentle spring-soft entrance; hover lifts card 3px with shadow expansion; no bouncing — calm wellness rhythm throughout.
- **Icons:** phosphor (rounded)
- **Best fit products:** Healthcare, Wellness, Education
- **Avoid for:** Fintech, Enterprise
- **Audience personas:** wellness-seekers, healthcare-professionals
- **Signature motifs:**
- White floating card with sky-blue and mint multi-layer shadow
- Pastel sky background with generous card spacing
- Rounded-[28px] pill-adjacent card shapes
- Soft accent dot or badge in mint green
- Large friendly Comfortaa heading with gentle weight
- **Hero archetypes:**
- Centered floating card stack on pastel sky background
- Gentle hero with wellness illustration and soft card stats
- **WOW effects:**
- Cards float in with staggered spring-soft delay creating depth sequence
- Hover card shadow expands softly — like a cloud rising
- Mint-green progress indicator with smooth fill animation
- **Surface recipes:**
- bg-white rounded-[28px] p-8 shadow-[0_4px_32px_rgba(125,211,252,0.20),0_1px_8px_rgba(0,0,0,0.04)] border border-sky-100
- bg-sky-50 min-h-screen p-8
- **Prompt-safe CSS cues:**
- bg-sky-50 min-h-screen p-8
- flex flex-wrap gap-6 justify-center
- bg-white rounded-[28px] p-8 shadow-[0_4px_32px_rgba(125,211,252,0.20)] border border-sky-100
- text-sky-600 font-semibold text-xl
- text-emerald-500 text-sm font-medium bg-emerald-50 rounded-full px-3 py-1
- **Anti-patterns:**
- Dark mode — light airy background is mandatory
- Harsh or visible borders — shadowless pastel borders only
- Dense compact layouts — spaciousness is the wellness signal
- High-saturation neon accents — muted pastels only
- Monospace or slab fonts — Comfortaa softness is essential
- **Forbidden treatments:**
- Drop shadows with dark color tint — soft sky/mint tints only
- Sharp corners anywhere — 28px+ radius throughout
- Error-red or warning-amber accents without softening — always muted
- **Copy tone:** Nurturing and empowering — second-person, positive framing, approachable healthcare language.

### Tactile Clay

- **Style ID:** `tactile-clay`
- **Description:** Physical 3D clay aesthetic — inflated rounded shapes, multi-layer shadows, bouncy spring physics.
- **Typography:** Heading `Nunito`, body `DM Sans`. Nunito ExtraBold for headings with gradient text fill; DM Sans for body; text scales generously to match inflated UI.
- **Color direction:** primary #c084fc, secondary #e879f9, accent #f472b6, background #fdf2f8, text #581c87
- **Layout DNA:** floating-cards-3d; radius 24px; density balanced; shadow 0 10px 40px -10px rgba(0,0,0,0.20), inset 0 1px rgba(255,255,255,0.80)
- **Materiality:** Inflated clay — cards appear physically puffed with inset top highlight + outer depth shadow; gradient bg from pink to purple creates sculptural ground.
- **Motion:** SPRING_BOUNCY — All elements spring-bouncy on entrance; hover inflates card (scale 1.03 + shadow increase); click deflates (scale 0.97 + shadow shrink) creating physical press.
- **Icons:** phosphor (rounded)
- **Best fit products:** Kids, Games, Creative
- **Avoid for:** Enterprise, Fintech
- **Audience personas:** children, creative-professionals
- **Signature motifs:**
- Puffy inflated card with inner top highlight + outer depth shadow
- Gradient bg from pink-100 to purple-100 as sculptural ground
- Gradient text fill on headings from gray-800 to gray-600
- Oversized rounded buttons that appear physically pressable
- Multi-stop shadow stack creating true 3D clay depth
- **Hero archetypes:**
- Grid of inflated clay cards on gradient pastel background
- Hero with large clay CTA button and puffed icon elements
- **WOW effects:**
- Cards physically inflate on hover — shadow stack expands outward
- Click press animation: shadow collapses as card compresses
- Staggered spring-bouncy entrance creates playful cascade
- Gradient text shimmers on heading hover
- **Surface recipes:**
- rounded-3xl p-6 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.20),inset_0_1px_rgba(255,255,255,0.80)] bg-white/80
- bg-gradient-to-b from-pink-100 to-purple-100 min-h-screen p-8
- **Prompt-safe CSS cues:**
- bg-gradient-to-b from-pink-100 to-purple-100 min-h-screen p-8
- rounded-3xl p-6 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2),inset_0_1px_rgba(255,255,255,0.8)]
- bg-white/80 backdrop-blur-sm
- text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-b from-gray-800 to-gray-600
- active:scale-95 active:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.2)] transition-all duration-150
- **Anti-patterns:**
- Flat design with no depth shadows — clay needs the full shadow stack
- Dark backgrounds — light gradient ground is essential to the 3D illusion
- Sharp corners — maximum roundness is the clay signature
- Monospace fonts — organic clay forbids machine aesthetics
- **Forbidden treatments:**
- Single-layer flat shadow — multi-stop shadow stack is mandatory
- Zero inner highlight — inset white gradient must be present
- Glassmorphism transparency — clay is opaque and physical
- **Copy tone:** Playful and delightful — sensory language, celebration of tactile interaction, inviting exploration.


## Cinematic

**When to reach for this category:** Film, Photography, Architecture, Portfolio, Art, Museum, Gallery, Luxury.

### B&W Motion Studio

- **Style ID:** `bw-motion-studio`
- **Description:** Black-and-white motion studio aesthetic — dramatic contrast, cinematic wipes, studio-grade minimalism
- **Typography:** Heading `Bebas Neue`, body `Outfit`. Display: Bebas Neue uppercase only. Body: Outfit 300–400. No italic. Letter-spacing: -0.05em on headlines, 0 on body. 2–3 word headlines maximum.
- **Color direction:** primary #ffffff, secondary #737373, accent #ffffff, background #000000, text #ffffff
- **Layout DNA:** full-bleed-hero; radius 0; density spacious; shadow none
- **Materiality:** Pure solid blacks and whites. No gradients, no textures, no noise. Contrast is the only surface treatment.
- **Motion:** CLIP_REVEAL — Horizontal wipe reveals: clip-path inset(0 100% 0 0) to inset(0). Text stagger: 50ms delay per word. Easing: cubic-bezier(0.77,0,0.175,1). Duration 800ms.
- **Icons:** lucide (outlined)
- **Best fit products:** Film, Photography, Architecture, Portfolio
- **Avoid for:** E-commerce, Kids, Healthcare
- **Audience personas:** filmmakers, photographers, architects
- **Signature motifs:**
- oversized display type as visual anchor
- horizontal rules as pacing dividers
- generous negative space as breathing room
- **Hero archetypes:**
- full-viewport black with centered white headline
- split-screen B&W with text left image right
- **WOW effects:**
- clip-path wipe reveals on scroll
- text character stagger animation
- cursor-follow spotlight on dark surfaces
- **Surface recipes:**
- pure black #000 no decoration
- white text on black, ultra-thin 1px white/10 border
- **Prompt-safe CSS cues:**
- bg-black text-white min-h-screen flex items-center
- text-8xl font-bold uppercase tracking-tighter
- border-t border-white/10 pt-8 mt-16
- opacity-50 text-xs tracking-[0.4em] uppercase
- w-full h-px bg-white/20 my-12
- **Anti-patterns:**
- color accents of any kind
- rounded corners
- shadows or depth effects
- busy multi-column grids
- **Forbidden treatments:**
- any color beyond black/white/gray
- glassmorphism
- gradients
- **Copy tone:** Terse. Declarative. No adjectives. 2–3 word headlines. Single sentence subheads.

### Cinematic Noir Gallery

- **Style ID:** `cinematic-noir-gallery`
- **Description:** Dark gallery experience with theatrical lighting — museum-grade presentation with focused spotlights on content
- **Typography:** Heading `Cormorant Garamond`, body `Lato`. Display: Cormorant Garamond 300–400, italic for pull quotes. Body: Lato 300, line-height 1.8. Generous letter-spacing on uppercase labels. Serif elegance over display weight.
- **Color direction:** primary #fef3c7, secondary #713f12, accent #fbbf24, background #0a0a0a, text #f5f5f4
- **Layout DNA:** centered-cinematic; radius 4px; density spacious; shadow radial-spotlight
- **Materiality:** Deep near-black grounds with amber warm tones as spotlight accents. Subtle vignette effect framing content. No harsh surfaces or flat fills.
- **Motion:** CLIP_REVEAL — Fade-in with upward drift 20px over 700ms. Spotlight intensity pulses on hover. Stagger 80ms per gallery item. Easing: ease-out cubic.
- **Icons:** heroicons (outlined)
- **Best fit products:** Art, Museum, Gallery, Luxury
- **Avoid for:** SaaS, Education
- **Audience personas:** art-collectors, gallery-directors
- **Signature motifs:**
- vignette-framed content presentation
- amber warm-light accents on dark grounds
- generous margins creating museum wall effect
- thin gold divider lines as section separators
- **Hero archetypes:**
- single artwork centered on near-black with ambient light halo
- gallery grid with dark inter-frame spacing and spotlight hover
- full-bleed artwork with bottom-anchored caption in warm amber
- **WOW effects:**
- ambient spotlight follows cursor across dark surface
- image hover reveals with theatrical lighting shift
- sequential gallery fade-in on scroll
- **Surface recipes:**
- near-black #0a0a0a with radial amber glow at content center
- warm stone text #f5f5f4 with amber accent #fbbf24 for labels
- **Prompt-safe CSS cues:**
- bg-[#0a0a0a] text-stone-100 min-h-screen
- max-w-2xl mx-auto px-8 py-24 text-center
- font-serif text-5xl leading-tight tracking-tight text-amber-100
- border border-amber-200/10 rounded-sm overflow-hidden
- text-amber-400 text-xs uppercase tracking-[0.3em] font-light
- **Anti-patterns:**
- bright or saturated colors
- busy multi-column grids
- sans-serif display headings
- hard drop shadows
- **Forbidden treatments:**
- white or light backgrounds
- neon accent colors
- geometric brutalist patterns
- **Copy tone:** Considered. Authoritative. Short sentences. Evocative but restrained. Museum label style.


## Poster

**When to reach for this category:** Restaurant, Hospitality, Craft, Culture, Events, Conference, Magazine, Media.

### Golden Charcoal

- **Style ID:** `golden-charcoal`
- **Description:** Warm charcoal base with golden highlight strokes — vintage poster warmth meets modern typography
- **Typography:** Heading `Abril Fatface`, body `Lora`. Display: Abril Fatface — major headlines only, 1–3 words per line. Body: Lora 400, line-height 1.7. Mix roman and italic Lora for hierarchy. Warm editorial voice.
- **Color direction:** primary #292524, secondary #78716c, accent #d97706, background #fafaf9, text #1c1917
- **Layout DNA:** asymmetric-scroll; radius 8px; density balanced; shadow soft-warm
- **Materiality:** Cream-white paper grounds. Charcoal ink weight headlines. Gold accent as painted stroke. Slight warmth in all background tints.
- **Motion:** FADE_UP — Sections fade up 24px over 500ms on scroll entrance. Stagger 120ms between elements. Hover: gold underline sweeps in 200ms. Spring soft easing.
- **Icons:** phosphor (rounded)
- **Best fit products:** Restaurant, Hospitality, Craft, Culture
- **Avoid for:** Tech, Developer-Tools
- **Audience personas:** hospitality-owners, cultural-enthusiasts
- **Signature motifs:**
- gold horizontal stroke as decorative accent between sections
- Abril Fatface headlines at generous scale with tight leading
- warm cream panels framing content blocks
- thin rule lines in amber/gold weight
- **Hero archetypes:**
- off-white hero with large Abril Fatface title and gold subtitle rule
- split layout: charcoal left panel with gold accent, content right
- **WOW effects:**
- gold ink stroke draws on entry via SVG path animation
- warm paper texture hover reveal on cards
- parallax scroll depth on hero poster typography
- **Surface recipes:**
- warm white #fafaf9 with charcoal headlines and amber accent details
- charcoal #292524 panel with gold #d97706 display text and cream body
- **Prompt-safe CSS cues:**
- bg-stone-50 text-stone-900 min-h-screen
- font-serif text-7xl leading-none tracking-tight text-stone-800
- text-amber-600 font-semibold uppercase tracking-widest text-sm
- border-l-4 border-amber-500 pl-6 italic text-stone-600
- bg-stone-200/60 rounded-lg p-8 shadow-sm
- **Anti-patterns:**
- cold blue or tech-color accents
- geometric sans-serif as primary display
- dark mode backgrounds
- dense data-heavy layouts
- **Forbidden treatments:**
- neon or electric colors
- glassmorphism
- sharp geometric corners with heavy borders
- **Copy tone:** Warm. Inviting. Craft-narrative style. Short poetic phrases. Evokes craft and tradition.

### Poster Bold Typography

- **Style ID:** `poster-bold-typography`
- **Description:** Poster-grade bold typography as the primary visual element — oversized letterforms, tight tracking, stacked compositions
- **Typography:** Heading `Oswald`, body `Barlow`. Headline: Oswald 700 uppercase, tracking -0.03em. Body: Barlow 400. Scale: hero 120px+, section 60–80px, body 16–18px. Stack type vertically at large scale.
- **Color direction:** primary #0f172a, secondary #475569, accent #f43f5e, background #f8fafc, text #0f172a
- **Layout DNA:** single-column-stack; radius 0; density spacious; shadow none
- **Materiality:** Paper-white backgrounds. Pure flat ink application, zero depth or elevation. Typography IS the visual. No decorative fills.
- **Motion:** CLIP_REVEAL — Letters slide in from bottom: translateY(100%) to 0 with clip. Per-word stagger 40ms. Duration 600ms. Easing: cubic-bezier(0.16,1,0.3,1).
- **Icons:** material-symbols (filled)
- **Best fit products:** Events, Conference, Magazine, Media
- **Avoid for:** Dashboard, Enterprise
- **Audience personas:** event-organizers, media-professionals
- **Signature motifs:**
- oversized stacked letterforms filling viewport width
- type as image — words as graphic elements
- extreme weight contrast between headlines and body
- accent color as single punctuation strike
- **Hero archetypes:**
- full-width stacked headline filling 80vw with contrasting accent line
- black ink on white with single rose-red accent word
- **WOW effects:**
- per-letter clip-path reveal animation on load
- hover color fill sweep across headline text
- oversized background text as ghost watermark
- **Surface recipes:**
- white #f8fafc with dense black Oswald text anchoring composition
- inverted: slate-900 bg with white headline and rose accent bar
- **Prompt-safe CSS cues:**
- bg-slate-50 text-slate-900 min-h-screen
- text-[clamp(4rem,12vw,10rem)] font-black uppercase tracking-tighter leading-none
- text-rose-500 font-black uppercase text-[clamp(3rem,8vw,7rem)]
- border-t-4 border-slate-900 pt-6 mt-12
- text-slate-500 text-lg font-medium max-w-lg
- **Anti-patterns:**
- decorative gradients or textures
- card-based layouts
- excessive padding softening typographic impact
- multi-typeface mixing beyond heading/body pair
- **Forbidden treatments:**
- glassmorphism
- rounded corners beyond 4px
- drop shadows or depth effects
- **Copy tone:** Direct. Punchy. Active voice. Short impact statements. Call-to-action driven.


## Tech

**When to reach for this category:** AI, Data-Science, Fintech, Space, Gaming, Crypto, Developer-Tools, CLI, Biotech, Research, Neural.

### Cyber Serif

- **Style ID:** `cyber-serif`
- **Description:** Cyberpunk meets classical serif — futuristic dark interfaces with unexpected serif elegance and neon highlights
- **Typography:** Heading `Playfair Display`, body `Fira Code`. Display: Playfair Display 900, tight leading. Body: Fira Code 300–400 as code-style prose. Unexpected tension between serif elegance and monospace body.
- **Color direction:** primary #22d3ee, secondary #0e7490, accent #a855f7, background #0f0f23, text #e0f2fe
- **Layout DNA:** bento-grid; radius 8px; density compact; shadow cyber-glow
- **Materiality:** Midnight indigo base. Cyan and purple neon highlights. Bento grid cells with subtle gradient borders. Serif headlines as unexpected tension against digital surface.
- **Motion:** SCALE_IN — Cells scale 0.95 to 1.0 on entrance. Neon border glow intensifies on hover 200ms. Headline letter-spacing expands slightly on scroll. No bouncy physics.
- **Icons:** material-symbols (two-tone)
- **Best fit products:** AI, Data-Science, Fintech
- **Avoid for:** Kids, Wellness
- **Audience personas:** data-scientists, AI-researchers
- **Signature motifs:**
- serif display headline as dissonant contrast to digital surface
- bento grid with glowing cyan border accents
- monospace code-prose body text as aesthetic choice
- subtle gradient glow halos on feature cells
- **Hero archetypes:**
- bento grid hero with large serif headline spanning top cells
- centered on midnight with serif title, cyan subtitle in Fira Code
- **WOW effects:**
- neon border glow ripple on bento cell hover
- serif headline text shimmer with cyan light sweep
- grid cells reveal stagger on scroll
- **Surface recipes:**
- midnight #0f0f23 surface with cyan #22d3ee glow borders and sky text
- bento cells #1a1a35 with purple/cyan gradient borders and serif headlines
- **Prompt-safe CSS cues:**
- bg-[#0f0f23] text-sky-100 min-h-screen
- grid grid-cols-3 gap-3 p-4
- bg-[#1a1a35] border border-cyan-500/20 rounded-lg p-5 shadow-[0_0_20px_-4px_rgba(34,211,238,0.15)]
- font-serif text-5xl font-black leading-none text-sky-100
- font-mono text-cyan-400 text-sm tracking-wide
- **Anti-patterns:**
- warm color palettes
- pure sans-serif composition without serif contrast
- light mode backgrounds
- playful rounded pill shapes
- **Forbidden treatments:**
- white backgrounds
- warm amber or orange tones
- glassmorphism blur panels
- **Copy tone:** Intellectual. Precise. Data-driven but lyrical. Merges academic tone with technical depth.

### Futurist Holo

- **Style ID:** `futurist-holo`
- **Description:** Sci-fi chrome split-screen — holographic gradients, sharp icon geometry, neon glow accents
- **Typography:** Heading `Orbitron`, body `Rajdhani`. Display: Orbitron 700–900, wide tracking. Body: Rajdhani 400–500. Gradient text on hero headlines. No serif, no script.
- **Color direction:** primary #06b6d4, secondary #8b5cf6, accent #ec4899, background #050510, text #ffffff
- **Layout DNA:** split-screen; radius 12px; density balanced; shadow neon-glow
- **Materiality:** Deep space black surface. Holographic gradient borders via background-clip trick. Neon glow halos on key elements. No solid fill accents — always gradient.
- **Motion:** SCALE_IN — Scale from 0.9 to 1.0 + opacity 0 to 1 over 500ms. Holographic shimmer sweeps on hover 300ms. Scan-line animation on borders. Easing: ease-out.
- **Icons:** material-symbols (sharp)
- **Best fit products:** AI, Space, Gaming, Crypto
- **Avoid for:** Healthcare, Education
- **Audience personas:** tech-enthusiasts, sci-fi-fans
- **Signature motifs:**
- holographic gradient border using background-clip technique
- neon glow halo on hero elements
- split-screen layout with contrasting light/dark panels
- sci-fi geometric grid lines as structural ornament
- **Hero archetypes:**
- split screen: dark left with neon glowing headline, right with holographic visual
- centered on space-black with multi-color gradient title and radial glow
- **WOW effects:**
- holographic gradient border shimmer animation
- neon glow pulse on CTA hover
- parallax floating geometric shapes
- **Surface recipes:**
- deep space #050510 with cyan/violet gradient borders and neon glow shadows
- surface panels #0d0d1f with subtle gradient shimmer on hover
- **Prompt-safe CSS cues:**
- bg-[#050510] text-white min-h-screen
- grid grid-cols-2 h-screen
- border border-transparent [background:linear-gradient(#050510,#050510)_padding-box,linear-gradient(135deg,#06b6d4,#8b5cf6,#ec4899)_border-box] rounded-xl
- text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400
- shadow-[0_0_60px_-10px_rgba(139,92,246,0.6)]
- **Anti-patterns:**
- light backgrounds
- warm earth tones
- rounded pill shapes
- soft or organic forms
- **Forbidden treatments:**
- white or light backgrounds
- warm color palettes
- serif typography
- **Copy tone:** Bold. Future-forward. Technical excellence implied. Short impactful statements. No hedging.

### Retro Terminal

- **Style ID:** `retro-terminal`
- **Description:** Nostalgic tech aesthetic — amber-on-dark monospace panels, sticky sidebar, CRT scanlines
- **Typography:** Heading `JetBrains Mono`, body `IBM Plex Mono`. All type monospace. Heading: JetBrains Mono 700. Body: IBM Plex Mono 400. Amber on near-black. Uppercase labels with letter-spacing. No italic.
- **Color direction:** primary #f59e0b, secondary #b45309, accent #d97706, background #0d0d0d, text #f59e0b
- **Layout DNA:** sticky-sidebar; radius 2px; density compact; shadow terminal-glow
- **Materiality:** CRT phosphor amber on near-black. Scanline overlay texture. No gradients. Monochrome palette with amber as the only light source.
- **Motion:** FADE_UP — Text fades in character-by-character 30ms per char. Screen flicker on load 2 frames. Cursor blink 500ms interval. No spring physics.
- **Icons:** lucide (filled)
- **Best fit products:** Developer-Tools, Fintech, CLI
- **Avoid for:** Fashion, Wellness
- **Audience personas:** developers, terminal-enthusiasts
- **Signature motifs:**
- CRT scanline overlay pattern on dark surface
- amber monospace text suggesting terminal output
- sticky left sidebar with navigation labels
- blinking cursor prompt symbol
- **Hero archetypes:**
- full-screen terminal split with sidebar nav and main content pane
- centered terminal window on near-black with amber prompt and blinking cursor
- **WOW effects:**
- typewriter character-by-character text reveal
- CRT screen flicker animation on page load
- scanline overlay intensity increases on hover
- **Surface recipes:**
- near-black #0d0d0d with amber #f59e0b text and scanline texture overlay
- amber/20 border panels with terminal prompt chevron indicators
- **Prompt-safe CSS cues:**
- bg-[#0d0d0d] text-amber-400 font-mono min-h-screen
- flex h-screen overflow-hidden
- w-56 border-r border-amber-500/20 p-4 flex-shrink-0
- text-xs text-amber-600 uppercase tracking-widest mb-1
- [background-image:repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.3)_2px,rgba(0,0,0,0.3)_4px)]
- **Anti-patterns:**
- light backgrounds
- rounded corners beyond 4px
- sans-serif as primary typeface
- pastel or saturated colors
- **Forbidden treatments:**
- white or cream backgrounds
- gradients of any kind
- glassmorphism or blur effects
- **Copy tone:** Technical. Concise. Command-line syntax influences. No marketing fluff. Data-first.

### Synapse Ambient

- **Style ID:** `synapse-ambient`
- **Description:** Neural-network inspired ambient glow with node-and-edge visual language — organic tech patterns
- **Typography:** Heading `Exo 2`, body `Inter`. Display: Exo 2 700 with wide tracking on headlines. Body: Inter 300–400, relaxed line-height 1.8. Cool emerald tints. No serif.
- **Color direction:** primary #10b981, secondary #059669, accent #34d399, background #022c22, text #d1fae5
- **Layout DNA:** centered-floating; radius 50%/16px; density spacious; shadow ambient-emerald-glow
- **Materiality:** Deep forest-dark grounds. Emerald node points with soft ambient glow halos. Edge lines at low opacity forming organic network patterns. No hard edges.
- **Motion:** FADE_UP — Elements drift up 32px with fade over 700ms on entrance. Node pulses radiate every 3s. Edges animate opacity 0.2 to 0.6 suggesting live signal. Spring soft easing.
- **Icons:** heroicons (outlined)
- **Best fit products:** AI, Biotech, Research, Neural
- **Avoid for:** E-commerce, Fashion
- **Audience personas:** researchers, biotech-professionals
- **Signature motifs:**
- node-and-edge network pattern as background texture
- circular node elements as UI anchors with emerald glow
- ambient light halos suggesting neural activity
- organic curved connecting lines between sections
- **Hero archetypes:**
- centered content floating above animated node-edge network background
- full-bleed dark forest green with glowing network nodes and central headline
- **WOW effects:**
- animated network graph with pulsing nodes as page background
- emerald glow trails on cursor movement
- sequential node-link reveal on scroll
- **Surface recipes:**
- deep forest #022c22 with ambient emerald glow nodes and mint text
- floating card panels #052e16 with emerald border glow and soft shadows
- **Prompt-safe CSS cues:**
- bg-[#022c22] text-emerald-100 min-h-screen
- max-w-3xl mx-auto px-8 py-32 text-center
- text-5xl font-bold tracking-wide text-emerald-50 leading-tight
- border border-emerald-500/20 rounded-2xl p-8 shadow-[0_0_40px_-8px_rgba(16,185,129,0.2)]
- text-emerald-400 text-sm font-medium tracking-[0.2em] uppercase
- **Anti-patterns:**
- warm or amber color palettes
- dense compact information grids
- serif display typography
- sharp angular geometric shapes
- **Forbidden treatments:**
- white or light backgrounds
- red or orange accent colors
- heavy drop shadows or solid elevations
- **Copy tone:** Scientific. Thoughtful. Discovery-oriented. Sentences that suggest emergence and connection.


## Commerce

**When to reach for this category:** E-commerce, Marketplace, DTC.

### Bold Commerce

- **Style ID:** `bold-commerce`
- **Description:** Conversion-focused e-commerce layout — split hero scroll, snappy motion, dominant CTAs
- **Typography:** Heading `Poppins`, body `Inter`. Display: Poppins 700–800. Body: Inter 400. CTA buttons: Poppins 600. Price: Poppins 800 with emerald color. No decorative fonts.
- **Color direction:** primary #111827, secondary #374151, accent #059669, background #ffffff, text #111827
- **Layout DNA:** split-hero-scroll; radius 12px; density balanced; shadow soft-elevation
- **Materiality:** Clean white canvas. Gray-900 for authority and CTAs. Emerald as the conversion signal color. Subtle surface lift for product cards. No decorative patterns.
- **Motion:** SPRING_SNAPPY — CTA buttons: scale 1.02 on hover 150ms spring. Product images: scale 1.05 on hover 200ms. Sticky panel locks to viewport. Cart interactions bounce 300ms spring.
- **Icons:** material-symbols (filled)
- **Best fit products:** E-commerce, Marketplace, DTC
- **Avoid for:** Portfolio, Documentation
- **Audience personas:** shoppers, brand-managers
- **Signature motifs:**
- sticky price + CTA panel alongside scrolling product imagery
- emerald price text as conversion focal point
- bold product name headline above the fold
- high-contrast black CTA button full-width
- **Hero archetypes:**
- split grid: left sticky CTA panel, right scrollable product gallery
- full-width product hero with overlaid title and buy button at bottom
- **WOW effects:**
- sticky checkout panel that remains visible during scroll
- product image zoom on hover with smooth spring
- cart add animation with badge increment
- **Surface recipes:**
- white #ffffff with gray-900 headers and emerald price callout
- gray-50 #f9fafb product cards with hover elevation and subtle border
- **Prompt-safe CSS cues:**
- grid grid-cols-1 lg:grid-cols-2 min-h-screen
- sticky top-0 h-screen flex flex-col justify-center p-12
- text-5xl font-extrabold tracking-tight text-gray-900
- text-3xl font-bold text-emerald-600
- w-full py-4 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 active:scale-95 transition-all
- **Anti-patterns:**
- heavy editorial whitespace reducing product visibility
- centered minimal layout with no CTA priority
- no call-to-action above fold
- soft pastel palette reducing conversion urgency
- **Forbidden treatments:**
- dark mode backgrounds
- decorative textures obscuring product
- excessive animation distracting from purchase flow
- **Copy tone:** Direct. Value-clear. Benefit-forward. Action verbs. No passive voice. Conversion-optimized.

