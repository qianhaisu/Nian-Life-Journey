# Design Trends

Prompt-oriented trend and art-direction reference extracted from `trends.ts` and the three dedicated art-pack modules. Use this file when the skill needs a broader aesthetic direction before choosing a concrete style, or when it needs richer pack-level DNA such as navigation, surface, and platform adaptation rules.

## Trend Quick Pick

| Trend | Best For | Typography Signal | Materiality Signal | Motion Signal |
|---|---|---|---|---|
| Human-Centric | Avoid safe tech blue and bland neutral gray | Ban standard system fonts (Inter, Roboto, Arial) | ABSOLUTE BAN on generic AI glassmorphism, glowing orbs, and heavy blurs | Hero sections must be grounded and architectural |
| Neo-Brutalism | Maximum contrast: black #000 + white #fff as base | Monospace display (Space Mono, JetBrains Mono) + chunky sans (Archivo Black, DM Sans Black) | Thick solid borders (3-4px black) | Abrupt transitions: step-start or 50ms duration |
| Warm Editorial | Warm earth tones: terracotta #c4683f, olive #6b7f3b, cream #faf5e4, charcoal #2d2d2d, burnt sienna #a0522d | Expressive serif display (Playfair Display, Fraunces, Lora) | Paper/ink texture via subtle SVG noise (1-2% opacity) | Scroll-triggered reveals: elements slide-up 20px with opacity fade |
| Tactile Puffy | Pastel-saturated: lavender #c4b5fd, peach #fdba74, mint #86efac, sky #7dd3fc, soft-pink #fda4af | Rounded sans-serif (Nunito, Quicksand, Comfortaa) | Soft 3D depth: multi-layer shadows, inner-shadow highlights for puffy/squishy feel | Spring physics: cubic-bezier(0 |
| OLED Dark Luxury | Near-monochrome base (black + white text) | Geometric sans (Outfit, Sora, General Sans) | True black backgrounds (#000 or oklch(0% 0 0)) | Smooth opacity reveals (0→1 over 600ms) |
| Retro-Futurism | Nostalgic neon: amber #f59e0b, teal #14b8a6, magenta #d946ef on dark navy #0f172a | Retro display (Unbounded, Space Grotesk, Archivo) | CRT scanline overlay (repeating-linear-gradient 2px) | Glitch effects (clip-path + translate jitter) |

## Trend Profiles

### Human-Centric

- **Version:** 1.0.0
- **Typography:** Ban standard system fonts (Inter, Roboto, Arial). Use bold, expressive, variable fonts (Space Grotesk, Syne, Plus Jakarta Sans). Oversized headings with tight line-height for impact. Kinetic typography responding to scroll/hover.
- **Materiality:** ABSOLUTE BAN on generic AI glassmorphism, glowing orbs, and heavy blurs. Use High-End Editorial Precision: solid backgrounds, 1px hairline borders (rgba(255,255,255,0.1)), and razor-sharp contrast. Texture via extremely subtle SVG noise (1-2% opacity), NEVER blurry gradients.
- **Composition:** Avoid edge-to-edge full-bleed layouts. Wrap main content in framed container with border-radius and generous negative space. Asymmetric CSS Grid or zine-style overlapping.
- **Color:** Avoid safe tech blue and bland neutral gray. Use warm organic palettes (earth tones), deep OLED dark modes (OKLCH color space), or high-contrast neo-brutalism accents.
- **Motion:** Hero sections must be grounded and architectural. NEVER use floating blurred orbs or messy animated gradients. Use strict grid animations, precise clipping masks, or elegant typography reveals. Spring-like easing: cubic-bezier(0.25, 1, 0.5, 1). Honor prefers-reduced-motion.

### Neo-Brutalism

- **Version:** 1.0.0
- **Typography:** Monospace display (Space Mono, JetBrains Mono) + chunky sans (Archivo Black, DM Sans Black). Oversized headings as graphic elements. Text used decoratively — rotate, overlap, uppercase. NEVER use rounded/friendly fonts.
- **Materiality:** Thick solid borders (3-4px black). Hard drop-shadows (4-6px offset, 0 blur, #000). ZERO blur, ZERO gradients, ZERO glassmorphism. Raw exposed structure. Visible grid lines as design element. Background: pure white or pure black only.
- **Composition:** Harsh grid with visible borders between cells (gap:0 + border on children). Boxes within boxes. Broken alignment for emphasis — one element intentionally misaligned. Content blocks stack vertically with thick dividers. No rounded corners (border-radius: 0).
- **Color:** Maximum contrast: black #000 + white #fff as base. Accent via single neon hue — lime #a3e635 OR hot-pink #ec4899 OR electric-yellow #facc15. NEVER use gradients. NEVER use more than 3 colors total. Color used sparingly for emphasis only.
- **Motion:** Abrupt transitions: step-start or 50ms duration. Scale jumps on hover (1.0→1.05 instant). Custom cursor effects. NO spring physics, NO smooth easing. Elements snap, not glide. Hover: shadow shrinks + element translates (pressed effect).

### Warm Editorial

- **Version:** 1.0.0
- **Typography:** Expressive serif display (Playfair Display, Fraunces, Lora). Body: Plus Jakarta Sans or DM Sans. Oversized headings with tight line-height. Mixed serif+sans hierarchy creates magazine feel.
- **Materiality:** Paper/ink texture via subtle SVG noise (1-2% opacity). Warm shadows (rgba(139,90,43,0.1)). 1px hairline borders. NO harsh edges. Surface feels like premium print.
- **Composition:** Magazine/zine layout: asymmetric CSS Grid, 2-col with one oversized. Generous whitespace as framing. Content wrapped in bordered container with padding from viewport edges. Overlapping elements for depth.
- **Color:** Warm earth tones: terracotta #c4683f, olive #6b7f3b, cream #faf5e4, charcoal #2d2d2d, burnt sienna #a0522d. NO cool blues or tech grays. Palette inspired by nature, craft, print.
- **Motion:** Scroll-triggered reveals: elements slide-up 20px with opacity fade. Parallax text at 0.5x speed. Smooth easing: cubic-bezier(0.16, 1, 0.3, 1). Transitions 300-500ms. Subtle, elegant, never flashy.

### Tactile Puffy

- **Version:** 1.0.0
- **Typography:** Rounded sans-serif (Nunito, Quicksand, Comfortaa). Bubbly, friendly letterforms. Medium-weight body, bold-to-black headings. Avoid sharp geometric fonts.
- **Materiality:** Soft 3D depth: multi-layer shadows, inner-shadow highlights for puffy/squishy feel. Clay/foam textures. Buttons feel pressable (inset shadow on :active). Surfaces are matte, not glossy.
- **Composition:** Large border-radius (16-24px). Floating cards with generous shadow. Playful overlapping elements. Generous padding everywhere. Feels like a friendly app, not a website.
- **Color:** Pastel-saturated: lavender #c4b5fd, peach #fdba74, mint #86efac, sky #7dd3fc, soft-pink #fda4af. Backgrounds slightly tinted (not pure white). High saturation but soft.
- **Motion:** Spring physics: cubic-bezier(0.34, 1.56, 0.64, 1). Bounce on appear. Squish on press (scaleY:0.95). Wobble on hover. Playful, toy-like interactions. 200-400ms duration.

### OLED Dark Luxury

- **Version:** 1.0.0
- **Typography:** Geometric sans (Outfit, Sora, General Sans). Tight letter-spacing (-0.02em headings). Light font-weight for body (300-400). Display: medium-to-bold. Clean, precise, minimal.
- **Materiality:** True black backgrounds (#000 or oklch(0% 0 0)). Ultra-thin borders (1px rgba(255,255,255,0.06-0.1)). Extremely subtle grain texture. NO heavy shadows. Surfaces distinguished by border only.
- **Composition:** Cinematic wide sections with dramatic vertical spacing. Centered content blocks, max-width 800px for text. Minimal elements per section. Let the black space breathe.
- **Color:** Near-monochrome base (black + white text). Single saturated accent hue via OKLCH (emerald oklch(0.7 0.2 155), violet oklch(0.6 0.2 300), or amber oklch(0.8 0.15 80)). Accent used sparingly — links, CTAs, highlights only.
- **Motion:** Smooth opacity reveals (0→1 over 600ms). Clip-path wipe animations. Text character-by-character stagger (30ms delay). Easing: cubic-bezier(0.16, 1, 0.3, 1). Elegant, cinematic.

### Retro-Futurism

- **Version:** 1.0.0
- **Typography:** Retro display (Unbounded, Space Grotesk, Archivo). Pixel/bitmap accents for labels. Mix of futuristic geometric + nostalgic rounded forms.
- **Materiality:** CRT scanline overlay (repeating-linear-gradient 2px). Chrome/metallic gradients (linear-gradient silver-to-gray). VHS noise artifacts. Glow effects via text-shadow with neon colors.
- **Composition:** Y2K card layouts: stacked panels with visible borders. Terminal/console-inspired sections (dark bg, mono font, green/amber text). Mixed old+new layout patterns.
- **Color:** Nostalgic neon: amber #f59e0b, teal #14b8a6, magenta #d946ef on dark navy #0f172a. Chrome silver #c0c0c0 for borders. High contrast but warm undertones.
- **Motion:** Glitch effects (clip-path + translate jitter). Typing/typewriter animations. Flickering opacity (0.8→1→0.9). Retro loading bars. VHS tracking distortion on scroll.

## Art Direction Packs

These packs are richer than trend profiles. Load an art pack when the model needs composition preference, platform adaptations, navigation archetypes, surface recipes, wow effects, and reference tags in one place.

### warm-editorial

- **Base trend name:** Warm Editorial
- **Composition preference:** asymmetric-editorial
- **Typography:** Expressive serif display (Playfair Display, Fraunces, Lora). Body: Plus Jakarta Sans or DM Sans. Oversized headings with tight line-height. Mixed serif+sans hierarchy creates magazine feel.
- **Materiality:** Paper/ink texture via subtle SVG noise (1-2% opacity). Warm shadows (rgba(139,90,43,0.1)). 1px hairline borders. NO harsh edges. Surface feels like premium print.
- **Color:** Warm earth tones: terracotta #c4683f, olive #6b7f3b, cream #faf5e4, charcoal #2d2d2d, burnt sienna #a0522d. NO cool blues or tech grays. Palette inspired by nature, craft, print.
- **Motion:** Scroll-triggered reveals: elements slide-up 20px with opacity fade. Parallax text at 0.5x speed. Smooth easing: cubic-bezier(0.16, 1, 0.3, 1). Transitions 300-500ms. Subtle, elegant, never flashy.
- **Layout rules:** radius 8px; shadow 0 4px 20px rgba(139,90,43,0.12); border 1px solid rgba(139,90,43,0.15); texture url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.015'/%3E%3C/svg%3E"); icon outlined; button outlined; intensity subtle
- **Copy tone:** Confident editorial voice. Short declarative sentences. No tech jargon. Headline: 3-5 words max. Subhead: single sentence. CTA: verb-first action.
- **Signature motifs:**
- asymmetrical masthead with oversized serif headline
- numbered sections like book chapters
- margin annotations as aside elements
- framed content modules with 1px hairline borders
- contrast between expressive serif display + sober sans body
- **Hero archetypes:**
- full-bleed image with editorial headline overlay
- split masthead: image left + text right with generous whitespace
- text-only hero with oversized tracking and decorative rule
- **Surface recipes:**
- cream/ivory paper (#faf5e4) with SVG noise at 1.5% opacity
- bordered card with warm shadow rgba(139,90,43,0.12)
- pull-quote block with left border-4 and italic serif text
- **WOW effects:**
- subtle SVG noise texture overlay at 1-2% opacity
- warm rgba shadows (139,90,43,0.1)
- magazine pull-quote with oversized serif
- 1px hairline rules as section dividers
- **Anti-patterns:**
- avoid glassmorphism and blurs
- no neon or electric colors
- no hard drop shadows
- no geometric sans-only typography
- **Forbidden treatments:**
- glassmorphism or frosted panels
- neon accent colors
- hard drop shadows
- monospace or tech-style fonts
- dark mode backgrounds
- floating blur blobs
- **Navigation archetypes:**
  - **mobile:** bottom tab bar with text labels
  - **tablet:** sidebar table-of-contents navigation
  - **desktop:** horizontal editorial nav with category dropdowns
- **Reference tags:**
  - **Untitled UI** (primary) — clean card layouts, whitespace rhythm, form patterns
  - **AlignUI** (secondary) — data display, metric cards, table styling
  - **Shopify Polaris** (secondary) — UX copy patterns, action-oriented CTAs
- **Platform adaptations:**
  - **mobile:** nav bottom tab bar with text labels; density single-column, generous vertical rhythm; CTA sticky bottom bar or inline after hero; supporting panels full-width modal sheets
    - Allowed modules: hero, article-card, pull-quote, cta-banner
    - Forbidden modules: sidebar, data-table, multi-column-grid
  - **tablet:** nav sidebar table-of-contents (w-56, collapsible); density 2-col asymmetric grid, 60/40 split; CTA right sidebar sticky or inline after lead paragraph; supporting panels slide-in drawer from left
    - Allowed modules: hero, article-card, pull-quote, aside-annotation, cta-banner
    - Forbidden modules: data-table, command-palette
  - **desktop:** nav horizontal editorial nav with category dropdowns; density 3-col editorial grid, 50/25/25; CTA above-fold in hero, repeated at article end; supporting panels right-rail for metadata + related links
    - Allowed modules: masthead, hero, article-card, pull-quote, aside-annotation, featured-grid, cta-banner
    - Forbidden modules: command-palette, glass-panel

### glass-premium

- **Base trend name:** OLED Dark Luxury
- **Composition preference:** centered-minimal
- **Typography:** Geometric sans (Outfit, Sora, General Sans). Tight letter-spacing (-0.02em headings). Light font-weight for body (300-400). Display: medium-to-bold. Clean, precise, minimal.
- **Materiality:** True black backgrounds (#000 or oklch(0% 0 0)). Ultra-thin borders (1px rgba(255,255,255,0.06-0.1)). Extremely subtle grain texture. NO heavy shadows. Surfaces distinguished by border only.
- **Color:** Near-monochrome base (black + white text). Single saturated accent hue via OKLCH (emerald oklch(0.7 0.2 155), violet oklch(0.6 0.2 300), or amber oklch(0.8 0.15 80)). Accent used sparingly — links, CTAs, highlights only.
- **Motion:** Smooth opacity reveals (0→1 over 600ms). Clip-path wipe animations. Text character-by-character stagger (30ms delay). Easing: cubic-bezier(0.16, 1, 0.3, 1). Elegant, cinematic.
- **Layout rules:** radius 16px; shadow 0 8px 32px rgba(0,0,0,0.4); border 1px solid rgba(255,255,255,0.08); texture backdrop-filter: blur(20px); background: rgba(255,255,255,0.05);; icon duotone; button ghost; intensity moderate
- **Copy tone:** Precise, technical authority. Active verbs. Metrics-first. Headline: noun + number or stat. CTA: imperative single word. Avoid filler adjectives.
- **Signature motifs:**
- frosted translucent control layer over content
- concentric rounded geometry (radius cascade: 8→12→16→24)
- specular highlight (inset 0 1px rgba(255,255,255,0.15))
- adaptive sidebar that collapses to bottom tab on mobile
- restrained blur: max 20px backdrop-filter, never background blur blobs
- **Hero archetypes:**
- app-shell hero: sidebar + top bar framing content area
- command center: metric cards above content in glass panel
- cinematic dark: single focal element centered on OLED black
- **Surface recipes:**
- glass panel: backdrop-filter:blur(20px) + bg:rgba(255,255,255,0.05) + border:rgba(255,255,255,0.08)
- elevated card: bg:rgba(255,255,255,0.03) + specular inset highlight at top edge
- command bar: bg:rgba(0,0,0,0.6) + blur(24px) + border-bottom:rgba(255,255,255,0.06)
- **WOW effects:**
- backdrop-filter: blur(20px) on panels
- specular highlight via inset_0_1px_rgba(255,255,255,0.1)
- OKLCH accent glow: shadow-[0_0_24px_-4px_oklch(...)]
- concentric rounded geometry (border-radius cascade)
- **Anti-patterns:**
- no warm earth tones
- no thick borders
- no serif fonts
- no paper textures
- no pure white backgrounds
- **Forbidden treatments:**
- floating blur blobs in background
- diffuse AI-chrome gradients
- warm earth tones
- thick solid borders
- serif fonts
- paper textures
- **Navigation archetypes:**
  - **mobile:** bottom tab bar (glass-morphic, backdrop-blur)
  - **tablet:** adaptive sidebar (w-64, collapses to icons)
  - **desktop:** persistent sidebar + horizontal top bar
- **Reference tags:**
  - **Apple Liquid Glass** (primary) — frosted panel treatment, specular highlights, blur depth
  - **AlignUI** (primary) — dashboard layout, metric cards, data tables
  - **Ant Design v6** (secondary) — component density, form layouts, navigation patterns
- **Platform adaptations:**
  - **mobile:** nav bottom tab bar (glass-morphic, backdrop-blur); density single-column, condensed card height; CTA sticky bottom CTA or floating action button; supporting panels bottom sheet with glass surface
    - Allowed modules: hero, metric-card, command-bar, cta-banner, glass-panel
    - Forbidden modules: persistent-sidebar, multi-pane-layout
  - **tablet:** nav adaptive sidebar (w-64, collapses to icon rail); density 2-col grid, equal-width cards; CTA top-right in header or inline card footer; supporting panels right drawer (glass surface, blur)
    - Allowed modules: hero, metric-card, glass-panel, data-table, command-bar
    - Forbidden modules: editorial-grid, pull-quote
  - **desktop:** nav persistent sidebar (w-64) + horizontal top bar; density dense 3-4 col grid, compact card height; CTA top-right in header, secondary in card footer; supporting panels right-rail command panel or detail pane
    - Allowed modules: dashboard-grid, metric-card, glass-panel, data-table, command-bar, detail-pane
    - Forbidden modules: editorial-masthead, pull-quote, paper-surface

### neo-brutalist-light

- **Base trend name:** Neo-Brutalism
- **Composition preference:** dense-grid
- **Typography:** Monospace display (Space Mono, JetBrains Mono) + chunky sans (Archivo Black, DM Sans Black). Oversized headings as graphic elements. Text used decoratively — rotate, overlap, uppercase. NEVER use rounded/friendly fonts.
- **Materiality:** Thick solid borders (3-4px black). Hard drop-shadows (4-6px offset, 0 blur, #000). ZERO blur, ZERO gradients, ZERO glassmorphism. Raw exposed structure. Visible grid lines as design element. Background: pure white or pure black only.
- **Color:** Maximum contrast: black #000 + white #fff as base. Accent via single neon hue — lime #a3e635 OR hot-pink #ec4899 OR electric-yellow #facc15. NEVER use gradients. NEVER use more than 3 colors total. Color used sparingly for emphasis only.
- **Motion:** Abrupt transitions: step-start or 50ms duration. Scale jumps on hover (1.0→1.05 instant). Custom cursor effects. NO spring physics, NO smooth easing. Elements snap, not glide. Hover: shadow shrinks + element translates (pressed effect).
- **Layout rules:** radius 0px; shadow 4px 4px 0px #000000; border 3px solid #000000; texture none; icon filled; button flat; intensity none
- **Copy tone:** Blunt, direct, zero fluff. All-caps headlines acceptable. Short punchy sentences. No softening language. CTA: single imperative word (BUY / GET / START). Functional over charming.
- **Signature motifs:**
- thick 3-4px solid black borders on all containers
- hard offset box-shadow (4px 4px 0 #000) — no blur
- oversized uppercase monospace headline as graphic element
- visible grid gap filled with border color (gap:0 + border on children)
- intentionally misaligned element for emphasis
- **Hero archetypes:**
- full-width bordered box: headline in Archivo Black + neon accent underline
- split hero: half black / half white with hard border divider
- stacked text blocks with alternating bg-black/bg-lime fill
- **Surface recipes:**
- card: bg-white border-3 border-black shadow-[4px_4px_0_#000]
- accent block: bg-lime-400 border-3 border-black, text-black uppercase
- divider: border-t-4 border-black, no margin collapse
- **WOW effects:**
- 4px offset hard drop-shadow on every card
- visible grid borders between cells
- scale jump on hover (1.0→1.05 instant, step-start)
- alternating bg-lime-400/bg-white for grid cells
- **Anti-patterns:**
- no rounded corners
- no glassmorphism
- no gradients
- no soft shadows
- no serif fonts
- no more than 3 colors total
- **Forbidden treatments:**
- any border-radius (stays at 0px)
- gradients of any kind
- glassmorphism or blur
- soft drop shadows
- more than 3 colors in palette
- serif or rounded/friendly fonts
- smooth easing or spring physics
- **Navigation archetypes:**
  - **mobile:** top bar with thick border-bottom, hamburger menu opens full-screen overlay
  - **tablet:** horizontal nav bar with thick borders, no dropdowns
  - **desktop:** sticky horizontal bar: border-bottom 3px solid #000, text-only links
- **Reference tags:**
  - **Figma Community Brutalist kits** (primary) — grid structure, border patterns, card templates
  - **Gumroad 2022 redesign** (primary) — bold typography as hero, high-contrast CTA
  - **Linear (early)** (secondary) — tight grid density, functional copy, sparse color use
- **Platform adaptations:**
  - **mobile:** nav top bar + full-screen menu overlay (bg-black, white links); density single-column, full-width bordered cards; CTA full-width sticky button at bottom, border-top 3px solid #000; supporting panels full-screen takeover, no partial sheets
    - Allowed modules: hero, bordered-card, cta-button, section-divider
    - Forbidden modules: sidebar, glass-panel, data-table, rounded-card
  - **tablet:** nav top horizontal bar, border-bottom 3px solid #000; density 2-col grid, equal borders on all cells; CTA inline after hero, full-width button; supporting panels full-width bottom bar, no drawers
    - Allowed modules: hero, bordered-card, grid-section, cta-button
    - Forbidden modules: sidebar, glass-panel, smooth-modal
  - **desktop:** nav sticky horizontal nav, 3px border-bottom, text-only links; density 3-4 col harsh grid, gap:0 + borders on children; CTA in hero, bold isolated button with hard shadow; supporting panels none — content-only, no rails
    - Allowed modules: masthead, hero, grid-section, bordered-card, cta-button, accent-block
    - Forbidden modules: sidebar, glass-panel, detail-pane, smooth-drawer
