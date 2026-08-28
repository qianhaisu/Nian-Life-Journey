# UX Guidelines

Prompt-optimized UX and customer-journey contract for `anti-ai-design`. Load this file during generation when the screen must feel complete, usable, and platform-correct — not just visually impressive.

## How to Use This Reference

- Use this file during **Phase 3 — Screen Generation** whenever the screen includes navigation, forms, onboarding, dashboards, settings, commerce, or any multi-state interaction.
- Apply the rules as **generation constraints**, not as post-hoc QA notes.
- If a request is small and static, apply only the sections that materially affect the screen.
- If the user asks to change one aspect only, keep the current UX structure intact unless the requested change would break one of the rules below.

## UX Copy Contract

### Headlines
- Headlines should usually be **3–5 words**.
- Prefer **verb-first**, **noun + outcome**, or **noun + metric** constructions.
- Avoid filler phrases like "seamless experience", "robust solution", "innovative platform", or "next-generation".
- Never use placeholder copy or vague product naming.

### Subheads and Body Copy
- Subheads should explain the value in **one sentence**.
- Body copy should use short declarative sentences with plain language.
- Use contextual, believable product copy tied to the screen's purpose.
- Avoid jargon unless the target audience clearly expects it.

### CTA Rules
- CTAs should be **imperative and specific**.
- Prefer action labels like `Start free`, `Compare plans`, `Create workspace`, `Review forecast`, `Send proposal`.
- Avoid vague buttons like `Submit`, `Continue`, `Learn more`, or `Click here` unless the context makes the action unmistakable.
- One screen should have **one dominant primary action**. Secondary actions must be visually subordinate.

### Anti-AI UX Copy Patterns
- Ban generic empty phrases: `Lorem ipsum`, `No items found`, `Welcome to our platform`, `Manage everything in one place`.
- Ban passive CTAs and empty reassurance copy.
- Ban labels that hide the real action.
- If error or empty state copy appears, it must explain **what happened**, **why it matters**, and **what to do next**.

## State Completeness Matrix

Any screen with dynamic content, async actions, forms, or data views must account for the states that matter. Do not render only the happy path.

| Surface Type | Minimum Required States | Notes |
|---|---|---|
| Form | default, focus, validation error, submitting, success | Errors live near the field; submit shows progress |
| Data list / table | loading, populated, empty, error | Empty state explains value and next action |
| Dashboard card | loading, populated, unavailable/error | Use skeletons or reserved space to prevent jumpiness |
| Onboarding / multi-step | current step, incomplete, completed, blocked/error | Show progress and preserve back path |
| CTA / async button | default, hover, active, focus, disabled, loading, success/error result | Loading must not look identical to disabled |
| Search / filter view | idle, loading, results, no results, failure | Keep filter/search state understandable |

### Loading States
- Use skeletons, shimmer, or reserved-space placeholders for views that take noticeable time.
- Buttons doing async work must show a spinner/progress state and prevent duplicate submits.
- Loading should preserve layout stability; do not let content jump when data arrives.

### Empty States
- Empty states must explain what the user can do next.
- Pair the message with a meaningful action, example, or setup step.
- The copy should communicate value, not just absence.

### Error States
- Error states must use plain language.
- Include an actionable recovery path such as retry, edit, or view details.
- Errors belong near the affected surface, not only in a distant banner.

### Success States
- Successful actions should show a clear but restrained confirmation.
- Use checkmarks, toasts, inline confirmation, or state change — not celebratory noise.
- Keep focus on the next logical step.

## Forms and Feedback

- Labels are permanent; placeholders are hints only.
- Validate on blur or submit, not on every keystroke unless the interaction truly demands it.
- Required fields should be obvious.
- Helper text should live near complex inputs.
- Password fields should expose show/hide when relevant.
- Multi-step flows should show visible progress and allow safe back navigation.
- Unsaved-change dismissals should warn before destructive loss.
- Destructive actions need confirmation or an immediate undo path.

## Navigation Consistency

- Navigation placement must stay consistent across related screens.
- Do not mix sidebar, bottom nav, tabs, and top nav at the same hierarchy level.
- Bottom navigation is for top-level destinations only.
- Large screens prefer sidebar or persistent structural navigation; smaller screens use bottom nav or top-bar patterns.
- Back behavior must be predictable and preserve state where possible.
- Core navigation should remain reachable from deep pages.
- Modals and sheets are not substitutes for primary navigation flows.

## Platform-Adaptive Interaction Rules

### Mobile
- Primary actions must be reachable in the thumb zone.
- Touch targets are at least **44×44px** with comfortable spacing.
- Do not rely on hover states.
- Bottom sheets, tab bars, and sticky CTAs should respect safe areas and gesture zones.

### Tablet
- Favor split layouts, side-by-side inspection, and visible navigation structure.
- Hover can enhance but not gate critical actions.
- Preserve readability in portrait and landscape.

### Desktop
- Hover, focus, active, and disabled states must all be explicit.
- Dense layouts are acceptable only when hierarchy remains clear.
- Persistent nav, breadcrumbs, filters, and detail panes should feel structurally stable across screens.

## Interaction and Motion Rules

- Motion must communicate state, hierarchy, or feedback — never decorative noise only.
- Prefer transform/opacity animations over layout-shifting animation.
- Micro-interactions generally sit in the **150–300ms** range.
- Use spring-like easing for hover/press states when the style allows it.
- Exit motion should usually be faster than entry motion.
- Respect reduced-motion expectations conceptually even when generating a static HTML artifact.
- Pressed states must not cause surrounding layout jitter.

## Accessibility Floor During Generation

- Text contrast targets: **4.5:1** for body text, **3:1** for large text and UI where appropriate.
- Every interactive element needs visible focus treatment.
- Icon-only actions require labels.
- Use semantic HTML before ARIA.
- Do not use color as the only carrier of meaning.
- Keep keyboard paths sensible for desktop-oriented screens.
- All meaningful images need descriptive alt text.

## Customer Journey Checkpoints

Use these checkpoints to decide what the screen must clarify.

### Discovery
- What is this?
- Why should the user care within five seconds?
- Is the first CTA obvious?

### Evaluation
- What proof, detail, preview, or comparison helps the user decide?
- What objections or uncertainty need to be reduced?
- Is the information hierarchy helping the user scan quickly?

### Activation
- What is the smallest confident next step?
- Does the form or action sequence reduce friction?
- Are success, error, and retry paths explicit?

### Retention / Repeat Use
- Does the screen help the user resume work or continue momentum?
- Are saved state, navigation return paths, and history cues preserved?
- Is the interface rewarding repeated use with clarity rather than novelty alone?

## Screen-Type Enforcement Shortcuts

### Landing / Marketing
- Clear value prop above the fold
- One primary CTA
- Proof or differentiation before deeper detail
- No generic hero structure unless the style transforms it convincingly

### Dashboard / Data Surface
- Immediate orientation: what changed, what matters, what action is available
- Visual hierarchy between key metrics, secondary panels, and supporting detail
- Loading/empty/error states on each critical data surface
- Navigation and filters stay stable across screens

### Form / Onboarding
- Minimize upfront cognitive load
- Use progressive disclosure for advanced options
- Errors are local and fixable
- Progress is visible when the task is multi-step

### Commerce / Pricing
- Distinguish plan or product hierarchy clearly
- Make the primary purchase action unmistakable
- Keep reassurance, detail, and comparison close to the action
- Empty and unavailable states explain what to do next

## Recovery Integrity Rules

When the user requests a partial change:
- Preserve the current navigation model unless the request is specifically about navigation.
- Preserve state completeness unless the user asks to simplify and the simplification still leaves the screen believable.
- Preserve the current copy tone unless the user asks to change voice or audience.
- Preserve platform interaction expectations unless the target platform changes.
- Preserve all untargeted UX dimensions by default; do not widen the change beyond the requested surface just because another approach would be easier.

## Fast Prompt Checklist

Before finalizing a generated screen, mentally check:
- Is there one clear primary action?
- Are the key states represented where the UI implies async data or interaction?
- Would a real user know what to do next?
- Does navigation stay consistent with the target platform and hierarchy?
- Does the copy sound specific and believable instead of generic?
