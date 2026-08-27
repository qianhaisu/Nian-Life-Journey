---
name: anti-ai-design
description: "Auto-orchestrating UI design skill that prevents generic AI-generated output. Detects project context and target platform, presents curated design style options, generates self-contained HTML screens with frozen foundation tokens for visual consistency, and recovers selectively when the user requests a change. Use when asked for: UI design, landing pages, dashboards, app screens, product pages, onboarding flows, or any visual interface output. Enforces 18 banned patterns and 12 required quality signals inline on every generation."
metadata:
  version: "1.1.0"
  author: claudible
---

# anti-ai-design

Auto-orchestrating UI design skill with mandatory anti-AI rules. Produces impossibly beautiful, visually distinct screens — never the generic AI-looked output.

## When to Use

Activate this skill whenever the user asks for:

- A landing page, hero section, or marketing screen
- A dashboard, admin panel, or data-rich interface
- A mobile app screen (iOS, Android) or responsive web UI
- An onboarding flow, signup form, or product walkthrough
- Any component library or design system screen
- "Make it look better", "redesign this", "create a UI for…"

## Sub-Skill Routing

Load ONLY the reference file needed for the current step. Do NOT load all files at once.

| Task | Load | Details |
|------|------|---------|
| Choose design style / art direction | `references/design-styles-catalog.md` | 36 styles across 11 categories |
| Select trend / art pack | `references/design-trends.md` | 6 trends, 3 art direction packs |
| Apply a design recipe | `references/design-recipes-catalog.md` | 15 complete design recipes |
| Choose hero section archetype | `references/hero-patterns.md` | 13 hero archetypes with CSS patterns |
| Apply platform layout rules | `references/platform-rules.md` | Mobile/iOS 26/Desktop/Tablet rules |
| Freeze and inject foundation tokens | `references/foundation-tokens.md` | Token freeze instructions and format |
| Apply UX / customer journey rules | `references/ux-guidelines.md` | UX enforcement, CJX patterns |
| Generate self-contained HTML screen | `references/output-template.md` | Output format and HTML template |

---

## Auto-Orchestration Flow

This skill is the **single orchestrator** for the full design flow. One invocation of `anti-ai-design` owns context detection, direction selection, screen generation, and selective recovery unless the user explicitly asks to stop or restart. Execute these four phases in sequence. Each phase has conditional logic — follow it precisely.

### Phase 1 — CONTEXT DETECTION

1. Scan the conversation and any attached files for: project name, existing brand colors, fonts, tech stack, target platform, and screen purpose.
2. Classify **project type** as one of: SaaS product · e-commerce · mobile app · portfolio · dashboard · marketing site · other.
3. Classify **target platform** as one of: mobile iOS · mobile Android · desktop web · tablet · responsive (all).
4. **If both are clear:** proceed to Phase 2 immediately.
5. **If ambiguous:** ask ONE clarifying question only. Example: "Is this for a mobile app or a desktop dashboard?" — do not ask multiple questions.
6. Note any existing brand tokens (colors, fonts, spacing scale) found in the project — you will use them in token freeze later.
7. **DESIGN.md Detection:** Check for `DESIGN.md` or `design.md` in the project root and `docs/` directory.
   - If found, parse and extract tokens using this mapping:

     | DESIGN.md Section | Frozen Token | Parse Strategy |
     |---|---|---|
     | Color Palette → Primary/Brand | `--color-primary` | First hex in Primary subsection |
     | Color Palette → Accent/Secondary | `--color-accent` | First hex in Accent subsection |
     | Color Palette → Background/Canvas | `--color-bg` | First hex in Background subsection |
     | Color Palette → Surface/Card | `--color-surface` | First hex in Surface subsection |
     | Typography → Display/Heading font | `--font-heading` | Font family from heading role |
     | Typography → Body font | `--font-body` | Font family from body role |
     | Layout → Border radius | `--radius` | Base radius value |
     | Layout → Spacing scale | `--spacing-base` | Base spacing unit |

   - **If DESIGN.md is comprehensive** (colors + fonts + spacing all present): skip Phase 2 entirely. Announce: "Found DESIGN.md — using your existing design system as foundation." Pre-freeze tokens and proceed to Phase 3.
   - **If DESIGN.md is partial** (e.g., only colors): use found tokens as constraints in Phase 2. Note: "Using brand colors from DESIGN.md; selecting complementary style for layout/motion."
   - **If DESIGN.md parsing fails or file not found:** proceed normally.
   - **Conflict rule:** Anti-AI banned patterns override DESIGN.md (e.g., if DESIGN.md uses Inter for headings, still ban it as display font and warn user).

### Phase 2 — DESIGN DIRECTION

1. Load `references/design-styles-catalog.md` (selective load — do not load other references yet).
2. From the catalog, select **2–3 styles** that best match the project type and context.
3. For each selected style, generate an **option card** in this format:

   ```
   [N]. **Style Name** — RECOMMENDED (if applicable)
   Vibe: [one sentence vibe/mood]
   Key aesthetic: [3 defining visual characteristics]
   ```

4. Mark exactly ONE option as **RECOMMENDED** based on best fit. If you produce 2 or 3 options, one and only one of them may carry the RECOMMENDED label.
5. Present the numbered list to the user and ask them to choose. Wait for their response before proceeding. Do not skip directly to screen generation unless the user explicitly says to continue with your recommendation.
6. If the user asks for a different style not in the list, accommodate it and proceed.

### Phase 2.5 — VISUAL DEMOS (Optional)

After presenting style options in Phase 2, if the user has not yet selected:

1. Generate a mini HTML demo (hero + one follow-up section) for each proposed style (2-3 demos).
2. Each demo: self-contained HTML (~150 lines), applies anti-AI rules, uses real content from project context.
3. Save demos as `demo-[style-id].html` in the working directory.
4. Tell the user: "I've generated [N] visual demos. Open them in your browser to compare before choosing."
5. Wait for user selection.
6. After selection, demo files can be deleted or kept per user preference.

**Skip this phase if:**
- User selects immediately from Phase 2 text descriptions
- User says "just go with your recommendation" or equivalent
- Insufficient context for meaningful demo (no product name, no content to use)
- User explicitly asks to skip demos

### Phase 3 — SCREEN GENERATION

1. Load `references/platform-rules.md` for the detected platform's layout rules.
2. Load `references/output-template.md` for the self-contained HTML format.
3. Load `references/foundation-tokens.md` to govern token freeze on screen 1 and token injection on later screens.
4. Load `references/ux-guidelines.md` whenever the screen includes navigation, forms, onboarding, dashboards, settings, commerce, async actions, or any multi-state interaction.
5. **If the screen is a landing page or hero section:** load `references/hero-patterns.md` and select the structural archetype matching the product type and chosen style.
6. Apply ALL Anti-AI Design Rules below (they are mandatory for every screen).
7. Apply the platform rules for the detected target platform.
8. Apply the UX guidelines as **generation constraints**, not as optional polish.
9. Generate a **self-contained HTML screen** using the approved design style.
   - Load `references/output-template.md` and obey its document structure, allowed-resource, and editability rules.
   - The HTML must be complete and renderable standalone (inline CSS, no local asset dependency, no build step, and no external dependencies except allowed CDN fonts/icons and Tailwind CDN when needed).
   - Treat the artifact as a file the user could save as `.html`, open directly in a browser, and hand to another tool without any repo-specific setup.
   - Use `data-ai-id` attributes on all major structural elements.
   - Use semantic HTML before ARIA-heavy fallbacks.
   - Use contextual, realistic copy — never lorem ipsum.
   - Enforce **state completeness** wherever the UI implies async data, forms, filtering, onboarding, or status changes.
   - Preserve **navigation consistency** across the screen and keep the platform's expected interaction model intact.
   - Ensure one clear primary CTA, believable UX copy, and explicit hover/active/focus/disabled states where relevant.

10. **After Screen 1 — FREEZE Foundation Tokens:**
   After generating the first screen, immediately extract and output the exact CSS custom properties used. Format:

   ```css
   /* FROZEN FOUNDATION TOKENS — inject into all subsequent screens */
   :root {
     --color-primary: <exact value>;
     --color-accent: <exact value>;
     --color-bg: <exact value>;
     --color-surface: <exact value>;
     --font-heading: <exact font stack>;
     --font-body: <exact font stack>;
     --radius: <exact value>;
     --spacing-base: <exact value>;
   }
   ```

   State explicitly: "Foundation tokens frozen. All subsequent screens will use these exact values."

11. **For Screens 2 and beyond — INJECT Frozen Tokens:**
   At the top of every new screen's `<style>` block, inject the frozen `:root {}` block verbatim before adding any other styles. Do not deviate from the frozen values unless the user explicitly requests a token change.
   - Load `references/foundation-tokens.md` before generating follow-up screens.
   - Reuse the frozen token block as the shared source of truth for colors, typography, spacing, radius, shadow style, and density.
   - Do not hardcode a second design system in later screens.

### Phase 3.5 — SELF-CRITIQUE (Internal)

After generating a screen, before presenting to user:

1. Score the output on each dimension (0–10):

   | Dimension | What to Check | Pass Threshold |
   |-----------|---------------|----------------|
   | Visual Hierarchy | One clear focal point, scannable structure, heading/body weight contrast | >= 7 |
   | Anti-AI Compliance | Zero banned patterns present + all 12 required quality signals | >= 8 |
   | Typography Quality | Display font is NOT body font, modular scale enforced, tracking correct | >= 7 |
   | Motion & Interaction | All relevant states explicit, easing matches style, no `transition:all` | >= 6 |
   | UX/Content Integrity | CTA action-specific, copy believable, states handled where implied | >= 7 |

2. **If ANY dimension scores below its threshold:**
   - Identify the specific violation(s).
   - Regenerate ONLY the failing aspect (do not restart the entire screen).
   - Re-score after fix.
   - **Cap:** 3 fix attempts per dimension maximum. If still failing after 3 attempts, present the best version with a transparent note about the limitation.

3. **If all dimensions pass:**
   - Present the screen to the user.
   - Append: "Quality check passed: [total]/50."

### Phase 4 — RECOVERY

When the user says "change the [color / layout / typography / motion / spacing]":

1. Identify the **single aspect** they want changed.
2. Regenerate **only that aspect** — do not alter other design decisions.
3. Preserve all untargeted design dimensions by default: keep colors, typography, layout structure, motion language, state completeness, navigation consistency, copy tone, platform interaction expectations, and frozen tokens unchanged unless the user's request explicitly targets one of those areas.
4. If changing a frozen token (e.g., `--color-primary`): update the token freeze output and note which token changed.
5. If changing layout: restructure the HTML layout only, preserve all colors, typography, effects, token values, and the current UX contract unless the user explicitly asks to change UX structure.
6. If changing typography: update fonts and type scale only, preserve all colors, layout, token values, and interaction structure.
7. After any recovery change, re-state the current frozen token block if tokens changed.
8. **Do NOT restart from Phase 1** unless the user explicitly asks to start over.

---

## Anti-AI Design Rules (MANDATORY)

These rules apply to **every screen, every generation, without exception**. Violation of any BANNED PATTERN requires immediate regeneration.

### BANNED PATTERNS (Violation = Reject & Regenerate)

- NO Inter, Roboto, Arial, Helvetica as display/heading fonts
- NO generic gradient blob backgrounds. DO use tasteful, subtle aurora/mesh gradients (e.g., Apple-style) anchored to corners or specific cards for a premium glowing effect.
- NO tech-blue (#0070f3, #2563eb) as primary without explicit user request
- NO symmetric 3-column feature grid (icon + title + description × 3)
- NO Undraw/Blush-style generic illustrations
- NO glassmorphism-on-gradient ONLY IF it looks cheap. DO use backdrop-blur-xl with very subtle border colors (e.g. border-white/20) for a premium glass effect.
- NO centered "Welcome to [Product]" hero with subtitle + single CTA; make it visually dynamic.
- NO `transition: all` — list properties explicitly
- NO box-shadow with blur > 20px (unless the active trend explicitly allows it)
- NO placeholder images from via.placeholder.com or picsum
- NO generic "lorem ipsum" placeholder text — use contextual, realistic copy
- NO perfectly symmetrical or overly balanced brutalist layouts; embrace intentional asymmetry
- NO default 16px font size everywhere; strictly enforce a modular typographic scale
- NO standard box-shadows; use tailored, multi-layered smooth shadows, or "stacked card" effects via pseudo-elements (e.g., layered borders and tinted shadows beneath primary cards)
- NO standard border-radius; use continuous squircle curves or fully rounded pills depending on the active trend
- NO emoji icons for UI elements; use the designated icon library from the Design Recipe (e.g. Heroicons, Phosphor, Tabler, Lucide, or Material Symbols)
- NO mixing icon families — pick ONE icon library per project and use it exclusively
- NO generic icons when specific alternatives exist (e.g. use "key" for API keys, not "settings" cog)

### REQUIRED QUALITY SIGNALS

- Headings MUST use the trend's display font, NEVER the body font
- Color palette MUST have >=3 distinct hues (no monochrome gray)
- Icons MUST be optically aligned with text baselines (`vertical-align: -0.125em` for inline)
- All icons in a view MUST use the same weight/stroke-width
- Icon sizes MUST follow the scale: 18px inline · 24px default · 32px feature · 48px hero
- For dashboard panels, incorporate subtle gradients on surface backgrounds (e.g. from transparent to 3% foreground) with low-opacity borders to create premium volumetric depth
- Every major container/card MUST have premium effects: layered stacked cards, inner borders `border border-white/10`, or complex shadows `shadow-[0_8px_30px_rgba(0,0,0,0.04)]`
- Each screen MUST have >=1 "surprise" element — choose from: Bento grid, masonry layout, parallax tilt, spotlight border, dock magnification, gooey menu, liquid swipe, stacked cards, or text mask reveal
- Buttons MUST have distinct hover/active/focus states (not just opacity change) with spring easing (`cubic-bezier(0.25, 1, 0.5, 1)`) and glow effects
- Spacing follows mathematical rhythm (4px or 8px base), never arbitrary; use staggered motion delays for sequential elements
- All images use descriptive alt text, never empty `alt=""`
- Design MUST exhibit extremely high DESIGN_VARIANCE and VISUAL_DENSITY. The UI must look "WOW", modern, and impossibly beautiful.

---

## Responsive Rules

Apply on every screen regardless of target platform:

- **Ban `h-screen`** — use `min-h-[100dvh]` to avoid iOS Safari viewport bugs
- **Ban flex percentage math** — use CSS Grid for layout; flexbox only for alignment within grid cells
- **Mobile fallback** — every multi-column grid must collapse to single-column at <640px
- **No hover-dependent interactions on mobile** — all critical actions must be tap-accessible
- **Semantic HTML first** — use `<button>`, `<nav>`, `<main>`, `<section>` before adding ARIA attributes
- **Touch targets** — minimum 44px × 44px for all interactive elements on mobile
- **Fluid scaling** — prefer `clamp()` and fluid type scales over rigid breakpoint jumps

---

## Foundation Token Freeze Protocol

After the first screen is approved (or generated, if no explicit approval step occurs):

1. Extract these exact CSS custom properties from the generated screen:
   - `--color-primary` — primary brand color
   - `--color-accent` — secondary/accent color
   - `--color-bg` — page background
   - `--color-surface` — card/panel surface color
   - `--font-heading` — heading font stack
   - `--font-body` — body font stack
   - `--radius` — base border radius
   - `--spacing-base` — base spacing unit (4px or 8px)

2. Output the frozen token block as shown in Phase 3 above.

3. For every subsequent screen, inject this `:root {}` block **verbatim** at the top of the `<style>` section — before any component styles.

4. **Recovery token update rule:** If the user requests a color/font/radius change, update the relevant token(s) in the frozen block and re-output the updated block. All other tokens remain frozen.

---

## Selective Loading Rule

**IMPORTANT:** This skill's `references/` directory contains multiple large files. Load ONLY the file required for the current phase:

- Phase 1 (context detection): read project `DESIGN.md` if it exists (from project filesystem, not from references/)
- Phase 2 (style selection): load `references/design-styles-catalog.md` only
- Phase 3 (generation): load `references/platform-rules.md` + `references/output-template.md`; add `references/ux-guidelines.md` whenever the screen has navigation, forms, onboarding, dashboard/data states, commerce flows, or any multi-state interaction; add `references/hero-patterns.md` when the screen is a landing page or hero section
- If user requests a specific recipe: load `references/design-recipes-catalog.md` only
- If UX enforcement is needed: load `references/ux-guidelines.md` only

**Never load all references at once.** Loading all files simultaneously will exhaust the context window and degrade output quality. One file at a time, only when needed.
