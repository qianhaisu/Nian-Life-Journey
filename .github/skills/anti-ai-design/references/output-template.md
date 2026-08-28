# Output Template

Prompt-optimized HTML output contract for `anti-ai-design`. Use this reference during generation whenever the skill must produce a real artifact that opens in a browser, remains editable, and preserves the visual contracts defined in the other references.

## Output Modes

### Full Screen / Page Generation
Use a complete HTML document when the user asks for a page, screen, dashboard, landing page, or any primary deliverable.

### Targeted Edit / Recovery
If the user is editing one specific element inside an existing artifact, return only the changed HTML fragment for that targeted surface.

### Component-Only Generation
Use an isolated fragment only when the user explicitly asks for a reusable component rather than a full screen.

## Core Output Principles

- The default deliverable is a **self-contained HTML document**.
- The document must open directly in a browser without a build step.
- The document must not depend on repo-local assets, local bundlers, or framework runtime bootstrapping.
- A user should be able to save the output as a single `.html` file, open it locally, and inspect or hand it off without any extra setup.
- Use semantic HTML5 elements before ARIA-heavy containers.
- Preserve editability by assigning `data-ai-id` to every major structural element.
- Reuse the frozen token block and style contract instead of hardcoding a second design system.
- Contextual copy must feel product-real, not placeholder-generated.

## Required Document Structure

### Head Requirements
A full document should include:
- `<!DOCTYPE html>`
- `<html lang="en">`
- `<meta charset="UTF-8">`
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Meaningful `<title>`
- Tailwind CDN script when utility classes are used
- Allowed icon/font resources only
- `<style>` block containing the frozen token block and any required CSS

### Body Requirements
- `<body>` should reference the shared background/token system
- App shell or top-level layout structure should appear before page-specific content when the screen implies persistent navigation
- Major content regions should be grouped into semantic sections (`header`, `nav`, `main`, `section`, `article`, `aside`, `footer`) where appropriate

## Full HTML Document Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Screen Name</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="[allowed icon or font resource]" rel="stylesheet" />
  <style>
    :root {
      /* frozen token block goes first */
    }

    /* additional component/layout CSS here */
  </style>
</head>
<body style="background: var(--color-bg, #fff); color: var(--color-text, #111);">
  <header data-ai-id="app-header">...</header>
  <main data-ai-id="page-main">...</main>
  <footer data-ai-id="page-footer">...</footer>
</body>
</html>
```

## Allowed External Resources

Allowed because they still preserve the self-contained artifact model:
- Tailwind CDN script
- Google Fonts stylesheet links when the selected style requires them
- One approved icon font/library CDN when the chosen recipe/style needs it

Avoid everything else by default.

## CSS and Token Rules

- Put the frozen `:root` token block at the top of `<style>`.
- Later CSS must consume those variables instead of duplicating hex values, radius values, or spacing numbers.
- If style-specific helper variables are needed, derive them from the frozen tokens.
- Prefer local CSS in the same file over external CSS files.
- Keep interaction and layout CSS inside the artifact so the file remains portable.

## data-ai-id Conventions

Every major structural element must get a meaningful `data-ai-id` so later edits can target it safely.

### Good Examples
- `app-header`
- `primary-nav`
- `hero-section`
- `feature-grid`
- `pricing-table`
- `signup-form`
- `dashboard-metrics`
- `results-panel`
- `page-footer`

### Rules
- IDs should be semantic, stable, and human-readable.
- Do not remove existing `data-ai-id` values during recovery/edit flows.
- Do not assign random GUID-like ids.
- Major containers, navigation, forms, cards, panels, and repeatable sections should all be targetable.

## Semantic HTML Expectations

- Use `<button>` for actions, not clickable `<div>`s.
- Use `<nav>` for navigation regions.
- Use `<main>` for the primary page content.
- Use `<section>`/`<article>`/`<aside>` based on meaning, not styling convenience.
- Use proper form elements (`label`, `input`, `textarea`, `select`, `button`).
- Add ARIA only when semantics alone are not enough.

## Interaction Script Guidance

- Prefer CSS-only interaction when possible.
- If JavaScript is necessary, keep it inline in a `<script>` block inside the same document.
- Avoid inline event-handler attributes like `onclick="..."` when a small script block can do the job more cleanly.
- Any JS should preserve the self-contained artifact model and avoid external runtime dependencies.

## Output Validity Checklist

Before considering an artifact done, check:
- Is it a complete HTML document when the user asked for a screen/page?
- Does it include the required meta/title/head structure?
- Is the frozen token block present at the top of `<style>` when a foundation exists?
- Are major structures labeled with `data-ai-id`?
- Does the document use semantic HTML?
- Can the file open directly in a browser without additional local assets?
- Can the artifact be saved as a single `.html` file and still render without a build step?
- Are only allowed external resources used?
- Does the output avoid placeholder copy and preserve the selected design system?

## Forbidden Output Patterns

- No placeholder `Lorem ipsum` copy
- No missing `<!DOCTYPE html>` in full-page output
- No artifact that depends on a local build step
- No artifact that depends on repo-local images, CSS files, JavaScript bundles, or component imports
- No removal of `data-ai-id` from existing major structures
- No second design system hardcoded outside the frozen/style token contract
- No non-semantic container soup when semantic tags fit the structure
- No duplicated Tailwind or CSS boilerplate that fights the token system
- No random inline hardcoded colors, spacing, or radius values that should come from tokens
- No reliance on inaccessible icon-only controls without labels

## Fast Prompt Reminder

- Full screen request → full HTML document.
- Keep it self-contained.
- Put the frozen tokens first.
- Make major structures editable with `data-ai-id`.
- Use semantic HTML before ARIA.
- Do not smuggle in a second design system.
able with `data-ai-id`.
- Use semantic HTML before ARIA.
- Do not smuggle in a second design system.
 system.
