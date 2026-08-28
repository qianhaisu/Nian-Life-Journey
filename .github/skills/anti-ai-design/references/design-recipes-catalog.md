# Design Recipes Catalog

LLM-readable recipe reference extracted from the legacy-but-still-useful `design-recipes.ts` source. Recipes are narrower than styles: they encode proven layout, icon, motion, and UI-pattern choices for recurring product situations. Use a recipe when the request strongly matches a known product shape; use a full style when the user asks for a stronger visual identity shift.

## Recipe Selection Guide

- Use a **style** first when the user cares most about art direction, mood, or premium visual identity.
- Use a **recipe** first when the user describes a familiar product shape such as dashboard, luxury landing page, fintech command center, education app, or editorial experience.
- Recipes can be paired with styles when their vibe archetypes and compatible art packs do not conflict.
- Respect each recipe's anti-patterns; they are the shortest path to avoiding generic AI output.

## Recipe Index

| Recipe | Product Types | Vibe Archetype | Layout | Motion | Compatible Art Packs |
|---|---|---|---|---|---|
| Nordic Minimal | SaaS, Minimal | Clean Scandinavian | left-aligned-hero | FADE_UP | warm-editorial |
| Editorial Luxury | Luxury, Creative | Magazine premium | full-bleed-hero | CLIP_REVEAL | warm-editorial, glass-premium |
| Electric Dashboard | Dashboard, Fintech | Data-dense dark | bento-grid | SCALE_IN | glass-premium |
| Warm Craft | Nature, Healthcare | Handmade organic | split-hero | SPRING_SOFT | warm-editorial |
| Playful Pop | Education, E-commerce | Fun bouncy | centered-hero | SPRING_BOUNCY | warm-editorial |
| Swiss Precision | SaaS, Dashboard | Grid-perfect | 12-col-grid | FADE_UP | warm-editorial |
| Noir Cinema | Creative, Luxury | Dramatic dark | centered-cinematic | CLIP_REVEAL | glass-premium |
| Soft Cloud | Healthcare, Education | Airy pastel | floating-cards | SPRING_SOFT | warm-editorial |
| Bold Commerce | E-commerce | Conversion-focused | split-hero-scroll | SPRING_SNAPPY | neo-brutalist-light, warm-editorial |
| Retro Terminal | Fintech, Dashboard | Nostalgic tech | sticky-sidebar | FADE_UP | glass-premium |
| Neo-Brutalist Raw |  | Punk graphic | dense-grid | SPRING_SNAPPY | neo-brutalist-light |
| Glass Aurora |  | Ethereal premium | centered-floating | SCALE_IN | glass-premium |
| Kinetic Magazine |  | Motion-editorial | asymmetric-scroll | CLIP_REVEAL | warm-editorial, glass-premium |
| Tactile Clay |  | Physical 3D | floating-cards-3d | SPRING_BOUNCY | warm-editorial |
| Futurist Holo |  | Sci-fi chrome | split-screen | SCALE_IN | glass-premium |

## Nordic Minimal

- **Recipe ID:** `nordic-minimal`
- **Description:** Clean Scandinavian restraint — breathable whitespace, hairline borders, and typographic confidence.
- **Product types:** SaaS, Minimal
- **Priority:** 1
- **Vibe archetype:** Clean Scandinavian
- **Layout preference:** left-aligned-hero
- **Motion preset:** FADE_UP
- **Signature element:** Oversized left-aligned heading with 1px hairline rule below
- **Font tier:** moderate
- **Icons:** heroicons (outlined)
- **Compatible art packs:** warm-editorial
- **CSS patterns:**
- border-b border-gray-200 pb-8 mb-12
- text-left max-w-xl space-y-4
- bg-gray-50 border border-gray-100 rounded-lg p-6
- tracking-tight font-semibold text-4xl text-gray-900
- text-gray-500 text-sm uppercase tracking-widest
- **Anti-patterns:**
- centered hero without motion
- heavy drop shadows
- gradients
- rounded-3xl or pill shapes

## Editorial Luxury

- **Recipe ID:** `editorial-luxury`
- **Description:** Magazine-premium full-bleed layouts with expressive serif display and editorial spacing.
- **Product types:** Luxury, Creative
- **Priority:** 1
- **Vibe archetype:** Magazine premium
- **Layout preference:** full-bleed-hero
- **Motion preset:** CLIP_REVEAL
- **Signature element:** Full-bleed image hero with serif headline overlaid at 90% height
- **Font tier:** bold
- **Icons:** lucide (rounded)
- **Compatible art packs:** warm-editorial, glass-premium
- **CSS patterns:**
- w-full h-screen relative overflow-hidden
- absolute bottom-12 left-12 right-12 text-white
- font-serif text-6xl leading-none tracking-tight
- border-t border-white/30 pt-4 mt-4
- mix-blend-multiply bg-black/40 absolute inset-0
- **Anti-patterns:**
- card-based layouts
- sans-serif body as headline
- pastel colors
- navigation bars inside hero

## Electric Dashboard

- **Recipe ID:** `electric-dashboard`
- **Description:** Data-dense dark bento grid with glowing metric cards and precise two-tone iconography.
- **Product types:** Dashboard, Fintech
- **Priority:** 1
- **Vibe archetype:** Data-dense dark
- **Layout preference:** bento-grid
- **Motion preset:** SCALE_IN
- **Signature element:** Glowing KPI card with OKLCH accent border and sparkline
- **Font tier:** moderate
- **Icons:** material-symbols (two-tone)
- **Compatible art packs:** glass-premium
- **CSS patterns:**
- bg-gray-950 text-white min-h-screen
- grid grid-cols-4 gap-3 p-4
- bg-gray-900 border border-white/8 rounded-xl p-5
- text-3xl font-bold tabular-nums text-emerald-400
- border border-emerald-500/20 shadow-[0_0_24px_-4px_oklch(0.7_0.2_155/0.3)]
- **Anti-patterns:**
- light backgrounds
- centered single-column layout
- serif fonts
- warm earth tones

## Warm Craft

- **Recipe ID:** `warm-craft`
- **Description:** Handmade organic warmth — earth tones, paper texture, and soft spring motion.
- **Product types:** Nature, Healthcare
- **Priority:** 1
- **Vibe archetype:** Handmade organic
- **Layout preference:** split-hero
- **Motion preset:** SPRING_SOFT
- **Signature element:** Paper-texture card with warm terracotta accent and handwritten-style label
- **Font tier:** safe
- **Icons:** tabler (outlined)
- **Compatible art packs:** warm-editorial
- **CSS patterns:**
- bg-amber-50 text-stone-800
- border border-amber-200 rounded-2xl p-6 shadow-sm
- text-terracotta font-medium uppercase tracking-wider text-xs
- flex gap-8 items-start max-w-5xl mx-auto px-6 py-16
- bg-stone-100 rounded-xl overflow-hidden aspect-square
- **Anti-patterns:**
- dark backgrounds
- neon or electric colors
- sharp geometric sans headlines
- glassmorphism

## Playful Pop

- **Recipe ID:** `playful-pop`
- **Description:** Fun bouncy energy for education and e-commerce — saturated pastels, rounded shapes, spring physics.
- **Product types:** Education, E-commerce
- **Priority:** 1
- **Vibe archetype:** Fun bouncy
- **Layout preference:** centered-hero
- **Motion preset:** SPRING_BOUNCY
- **Signature element:** Oversized rounded pill button with drop shadow + bounce hover
- **Font tier:** moderate
- **Icons:** phosphor (rounded)
- **Compatible art packs:** warm-editorial
- **CSS patterns:**
- bg-violet-50 min-h-screen
- rounded-3xl px-10 py-5 bg-violet-500 text-white font-bold text-lg shadow-lg hover:shadow-xl
- grid grid-cols-2 md:grid-cols-3 gap-4 p-6
- bg-white rounded-2xl p-5 shadow-md border border-violet-100
- text-violet-600 font-extrabold text-5xl text-center leading-none
- **Anti-patterns:**
- dark color scheme
- hairline borders
- monospace fonts
- grid-dense data layouts

## Swiss Precision

- **Recipe ID:** `swiss-precision`
- **Description:** Grid-perfect Helvetica-era rigour — 12-column system, proportional spacing, zero decoration.
- **Product types:** SaaS, Dashboard
- **Priority:** 2
- **Vibe archetype:** Grid-perfect
- **Layout preference:** 12-col-grid
- **Motion preset:** FADE_UP
- **Signature element:** Strict 12-column grid with visible baseline rhythm and numbered section markers
- **Font tier:** safe
- **Icons:** heroicons (outlined)
- **Compatible art packs:** warm-editorial
- **CSS patterns:**
- grid grid-cols-12 gap-x-4 gap-y-0
- col-span-8 border-l-4 border-black pl-6
- text-xs font-mono text-gray-400 tracking-widest uppercase
- border-t border-gray-900 pt-4
- max-w-screen-xl mx-auto px-8
- **Anti-patterns:**
- decorative blurs or gradients
- asymmetric overlapping elements
- rounded corners beyond 4px
- motion beyond fade

## Noir Cinema

- **Recipe ID:** `noir-cinema`
- **Description:** Dramatic dark cinematics — deep blacks, clip-path reveals, bold display typography.
- **Product types:** Creative, Luxury
- **Priority:** 2
- **Vibe archetype:** Dramatic dark
- **Layout preference:** centered-cinematic
- **Motion preset:** CLIP_REVEAL
- **Signature element:** Black full-viewport section with single white headline at optical centre
- **Font tier:** bold
- **Icons:** material-symbols (filled)
- **Compatible art packs:** glass-premium
- **CSS patterns:**
- bg-black text-white min-h-screen flex items-center justify-center
- text-7xl font-black uppercase tracking-tighter leading-none
- border border-white/10 p-px rounded-none
- opacity-60 text-xs tracking-[0.3em] uppercase text-gray-400
- w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent my-12
- **Anti-patterns:**
- light backgrounds
- rounded pill shapes
- pastel or warm palette
- busy multi-column grids

## Soft Cloud

- **Recipe ID:** `soft-cloud`
- **Description:** Airy pastel floating cards — approachable and gentle, ideal for healthcare and education.
- **Product types:** Healthcare, Education
- **Priority:** 2
- **Vibe archetype:** Airy pastel
- **Layout preference:** floating-cards
- **Motion preset:** SPRING_SOFT
- **Signature element:** Floating white card on tinted pastel background with soft multi-layer shadow
- **Font tier:** safe
- **Icons:** phosphor (rounded)
- **Compatible art packs:** warm-editorial
- **CSS patterns:**
- bg-sky-50 min-h-screen p-8
- bg-white rounded-3xl p-8 shadow-[0_4px_32px_rgba(0,0,0,0.06)] border border-sky-100
- text-sky-700 font-semibold text-lg
- flex flex-wrap gap-4 justify-center
- text-gray-500 text-sm leading-relaxed
- **Anti-patterns:**
- dark mode
- harsh borders
- monospace or slab fonts
- high-contrast neo-brutalist patterns

## Bold Commerce

- **Recipe ID:** `bold-commerce`
- **Description:** Conversion-focused e-commerce layout — split hero scroll, snappy motion, dominant CTAs.
- **Product types:** E-commerce
- **Priority:** 1
- **Vibe archetype:** Conversion-focused
- **Layout preference:** split-hero-scroll
- **Motion preset:** SPRING_SNAPPY
- **Signature element:** Sticky price + CTA block alongside scrolling product imagery
- **Font tier:** moderate
- **Icons:** material-symbols (filled)
- **Compatible art packs:** neo-brutalist-light, warm-editorial
- **CSS patterns:**
- grid grid-cols-1 lg:grid-cols-2 min-h-screen
- sticky top-0 h-screen flex flex-col justify-center p-12
- text-5xl font-extrabold tracking-tight text-gray-900
- text-3xl font-bold text-emerald-600
- w-full py-4 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 active:scale-95 transition-all
- **Anti-patterns:**
- heavy editorial whitespace
- centered minimal layout
- no call-to-action above fold
- soft pastel palette

## Retro Terminal

- **Recipe ID:** `retro-terminal`
- **Description:** Nostalgic tech aesthetic — amber-on-dark monospace panels, sticky sidebar, CRT scanlines.
- **Product types:** Fintech, Dashboard
- **Priority:** 3
- **Vibe archetype:** Nostalgic tech
- **Layout preference:** sticky-sidebar
- **Motion preset:** FADE_UP
- **Signature element:** CRT scanline overlay with amber monospace text on near-black surface
- **Font tier:** bold
- **Icons:** lucide (filled)
- **Compatible art packs:** glass-premium
- **CSS patterns:**
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

## Neo-Brutalist Raw

- **Recipe ID:** `neo-brutalist-raw`
- **Description:** Punk graphic design — hard grid, zero radius, thick black borders, neon accent.
- **Product types:** 
- **Priority:** 10
- **Vibe archetype:** Punk graphic
- **Layout preference:** dense-grid
- **Motion preset:** SPRING_SNAPPY
- **Signature element:** Hard 4px black border with 4px offset drop shadow on every card
- **Font tier:** bold
- **Icons:** tabler (filled)
- **Compatible art packs:** neo-brutalist-light
- **CSS patterns:**
- border-4 border-black shadow-[4px_4px_0_#000]
- bg-white text-black rounded-none
- uppercase font-black tracking-wider
- grid grid-cols-3 gap-0 border-4 border-black
- bg-lime-400 hover:bg-lime-300 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all
- **Anti-patterns:**
- rounded corners
- gradients
- glassmorphism
- soft shadows
- serif fonts

## Glass Aurora

- **Recipe ID:** `glass-aurora`
- **Description:** Ethereal premium glassmorphism — layered frosted panels over aurora gradient background.
- **Product types:** 
- **Priority:** 10
- **Vibe archetype:** Ethereal premium
- **Layout preference:** centered-floating
- **Motion preset:** SCALE_IN
- **Signature element:** Frosted glass card with aurora gradient blob visible through blur
- **Font tier:** bold
- **Icons:** phosphor (rounded)
- **Compatible art packs:** glass-premium
- **CSS patterns:**
- relative overflow-hidden bg-gradient-to-br from-violet-950 via-indigo-900 to-sky-900 min-h-screen
- absolute w-96 h-96 rounded-full blur-3xl opacity-40 pointer-events-none
- bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8
- text-white font-semibold text-xl
- shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_rgba(255,255,255,0.2)]
- **Anti-patterns:**
- white backgrounds
- no blur effect
- warm earth tones
- harsh solid borders

## Kinetic Magazine

- **Recipe ID:** `kinetic-magazine`
- **Description:** Motion-editorial with asymmetric scroll — text layers, parallax depth, clip-path reveals.
- **Product types:** 
- **Priority:** 10
- **Vibe archetype:** Motion-editorial
- **Layout preference:** asymmetric-scroll
- **Motion preset:** CLIP_REVEAL
- **Signature element:** Overlapping typography layers with different scroll speeds creating parallax depth
- **Font tier:** bold
- **Icons:** heroicons (outlined)
- **Compatible art packs:** warm-editorial, glass-premium
- **CSS patterns:**
- relative overflow-hidden
- absolute text-[20vw] font-black text-gray-100 select-none pointer-events-none leading-none
- relative z-10 max-w-2xl
- text-5xl font-bold leading-tight tracking-tight
- grid grid-cols-[2fr_1fr] gap-12 items-start
- **Anti-patterns:**
- static non-scrolling layout
- uniform symmetric grid
- flat monochrome palette
- rounded pill elements

## Tactile Clay

- **Recipe ID:** `tactile-clay`
- **Description:** Physical 3D clay aesthetic — inflated rounded shapes, multi-layer shadows, bouncy spring physics.
- **Product types:** 
- **Priority:** 10
- **Vibe archetype:** Physical 3D
- **Layout preference:** floating-cards-3d
- **Motion preset:** SPRING_BOUNCY
- **Signature element:** Puffy inflated card with inner highlight shadow + outer depth shadow
- **Font tier:** moderate
- **Icons:** phosphor (rounded)
- **Compatible art packs:** warm-editorial
- **CSS patterns:**
- bg-gradient-to-b from-pink-100 to-purple-100 min-h-screen p-8
- rounded-3xl p-6 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2),inset_0_1px_rgba(255,255,255,0.8)]
- bg-white/80 backdrop-blur-sm
- text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-b from-gray-800 to-gray-600
- active:scale-95 active:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.2)] transition-all duration-150
- **Anti-patterns:**
- flat design with no depth
- dark backgrounds
- sharp corners
- monospace fonts

## Futurist Holo

- **Recipe ID:** `futurist-holo`
- **Description:** Sci-fi chrome split-screen — holographic gradients, sharp icon geometry, neon glow accents.
- **Product types:** 
- **Priority:** 10
- **Vibe archetype:** Sci-fi chrome
- **Layout preference:** split-screen
- **Motion preset:** SCALE_IN
- **Signature element:** Holographic gradient border with scan-line shimmer animation
- **Font tier:** bold
- **Icons:** material-symbols (sharp)
- **Compatible art packs:** glass-premium
- **CSS patterns:**
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
