# anti-ai-design

An auto-orchestrating UI design skill for Claude Code, Gemini CLI, Cursor, Codex, and other Agent Skills Spec-compatible runtimes. It prevents generic AI-generated UI output by combining anti-AI design rules, platform-aware layout logic, UX/CJX enforcement, frozen foundation tokens, and a self-contained HTML output contract.

## What It Does

- **Detects** project type, target platform, and existing DESIGN.md brand tokens
- **Presents** 2–3 design directions with a recommended option
- **Generates** optional visual demos for comparison before committing to a style
- **Applies** anti-AI rules, UX/CJX rules, platform rules, and frozen foundation tokens
- **Self-critiques** output on 5 quality dimensions before presenting to user
- **Generates** self-contained HTML screens that can open directly in a browser
- **Recovers** selectively when the user asks to change color, layout, typography, motion, or spacing

## Key Features

### Hero Patterns (NEW in v1.1.0)

13 hero section archetypes with complete specs:

| Archetype | Best For |
|-----------|----------|
| Full-Width Text | SaaS, Minimal, Docs |
| Split Asymmetric | Product, Startup, App |
| Full-Bleed Image | Luxury, Creative, Editorial |
| Centered Cinematic | Film, AI, Crypto, Dark UI |
| Bento Hero | Dashboard, Analytics, Fintech |
| Product Screenshot | App Launch, SaaS, Dev Tools |
| Scroll-Trigger Reveal | Portfolio, Agency, Creative |
| Dashboard Metric | Fintech, Analytics, Admin |
| Text-Only Masthead | Editorial, Magazine, Blog |
| Stacked Cards | Premium SaaS, Fintech |
| Gradient Mesh | Premium, AI, Music, Crypto |
| Video Ambient | Entertainment, Brand, Lifestyle |
| Illustration-Led | Education, Kids, Startup, Health |

Each archetype includes: content hierarchy, HTML skeleton, Tailwind CSS patterns, responsive collapse, motion specs, anti-patterns, and LLM prompt snippets.

### DESIGN.md Compatibility (NEW in v1.1.0)

Automatically detects and parses VoltAgent-format `DESIGN.md` files:
- Maps brand tokens to frozen foundation tokens
- Skips style selection if DESIGN.md is comprehensive
- Uses partial tokens as constraints during style selection

### Self-Critique Quality Gate (NEW in v1.1.0)

Scores generated output on 5 dimensions before presenting:
- Visual Hierarchy (≥7)
- Anti-AI Compliance (≥8)
- Typography Quality (≥7)
- Motion & Interaction (≥6)
- UX/Content Integrity (≥7)

### Visual Demo Generation (NEW in v1.1.0)

Optional Phase 2.5 generates 2-3 mini HTML demos for visual comparison before committing to a design direction.

## Install

### Claude Code

```bash
cp -r anti-ai-design ~/.claude/skills/anti-ai-design
```

Or symlink for live development:

```bash
ln -s "$(pwd)/anti-ai-design" ~/.claude/skills/anti-ai-design
```

### Gemini CLI

```bash
gemini skills link "$(pwd)/anti-ai-design"
```

### Cursor / Other IDEs

Copy the skill directory to your IDE's skills folder or configure the skill path in settings.

## Usage

```text
Use anti-ai-design to design a SaaS onboarding flow for mobile.
```

```text
Design a dashboard for my analytics app.
```

```text
Create a landing page hero section for my AI product.
```

The skill orchestrates: Context Detection → Design Direction → (Optional) Visual Demos → Screen Generation → Self-Critique → Recovery.

## Skill Contents

```text
anti-ai-design/
├── LICENSE
├── README.md
├── CHANGELOG.md
├── SKILL.md
└── references/
    ├── hero-patterns.md         # 13 hero archetypes (NEW)
    ├── design-styles-catalog.md # 36 styles across 11 categories
    ├── design-recipes-catalog.md
    ├── design-trends.md
    ├── platform-rules.md
    ├── ux-guidelines.md
    ├── foundation-tokens.md
    └── output-template.md
```

## Context Budget

The skill uses selective loading to stay within context limits:

| Phase | Files Loaded | ~Tokens |
|-------|--------------|---------|
| Phase 2 (style selection) | SKILL + styles-catalog | ~32K |
| Phase 3 (hero + forms) | SKILL + platform + output + hero + ux + tokens | ~21K |
| Phase 3 (non-hero) | SKILL + platform + output + ux | ~12K |

Safe for models with 128K+ context (Claude, Gemini, GPT-4o, Codex).

## Requirements

Any Agent Skills Spec-compatible platform: Claude Code, Gemini CLI, Cursor, Codex CLI, or similar.

## License

MIT
