# Changelog

All notable changes to the `anti-ai-design` skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-05-06

### Added

#### Hero Patterns Reference (`references/hero-patterns.md`)
- 13 hero section archetypes with complete specifications:
  - Full-Width Text, Split Asymmetric, Full-Bleed Image, Centered Cinematic
  - Bento Hero, Product Screenshot, Scroll-Trigger Reveal, Dashboard Metric
  - Text-Only Masthead, Stacked Cards, Gradient Mesh, Video Ambient, Illustration-Led
- Each archetype includes:
  - Content hierarchy (headline size, subhead ratio, CTA placement)
  - HTML skeleton with `data-ai-id` conventions
  - Tailwind CSS patterns
  - Responsive collapse behavior (desktop → tablet → mobile)
  - Motion specs (entry animation, easing, scroll behavior)
  - Archetype-specific anti-patterns
  - LLM prompt snippet (VoltAgent Agent Prompt Guide style)
- 8 hero-specific global anti-patterns supplementing SKILL.md banned patterns

#### DESIGN.md Compatibility (Phase 1)
- Auto-detection of `DESIGN.md` or `design.md` in project root and `docs/`
- Token mapping from VoltAgent DESIGN.md format:
  - Color Palette → `--color-primary`, `--color-accent`, `--color-bg`, `--color-surface`
  - Typography → `--font-heading`, `--font-body`
  - Layout → `--radius`, `--spacing-base`
- Skip Phase 2 when DESIGN.md is comprehensive (colors + fonts + spacing)
- Use partial tokens as constraints when DESIGN.md is incomplete
- Conflict resolution: Anti-AI banned patterns override DESIGN.md

#### Visual Demo Generation (Phase 2.5)
- Optional phase after style selection
- Generates 2-3 mini HTML demos (hero + one section each)
- Self-contained HTML (~150 lines), applies anti-AI rules
- Saves as `demo-[style-id].html` in working directory
- Skip conditions: immediate selection, "go with recommendation", insufficient context

#### Self-Critique Quality Gate (Phase 3.5)
- Internal quality check before presenting output to user
- 5 scoring dimensions (0-10 scale):
  - Visual Hierarchy (threshold ≥7)
  - Anti-AI Compliance (threshold ≥8)
  - Typography Quality (threshold ≥7)
  - Motion & Interaction (threshold ≥6)
  - UX/Content Integrity (threshold ≥7)
- Selective regeneration for failing dimensions
- 3-attempt cap per dimension
- Quality note appended to output

### Changed

- **SKILL.md**: Reorganized phases (1 → 2 → 2.5 → 3 → 3.5 → 4)
- **Sub-Skill Routing**: Added hero-patterns.md entry
- **Phase 3**: Added step 5 for hero-patterns loading on landing pages
- **Selective Loading Rule**: Updated for hero-patterns.md and DESIGN.md detection
- **Step numbering**: Fixed duplicate step 9 in Phase 3 (now 9, 10, 11)

### Context Budget

| Scenario | Tokens |
|----------|--------|
| Phase 2 (styles catalog) | ~32K |
| Phase 3 hero + forms | ~21K |
| Phase 3 non-hero | ~12K |

Safe for 128K+ context models.

---

## [1.0.0] - 2026-04-15

### Added

- Initial release
- 4-phase auto-orchestration flow (Context Detection → Design Direction → Screen Generation → Recovery)
- 18 banned patterns + 12 required quality signals
- 36 design styles across 11 categories
- 15 complete design recipes
- 6 design trends + 3 art direction packs
- Platform rules (Mobile, iOS 26, Tablet, Desktop)
- UX/CJX guidelines with state completeness matrix
- Foundation token freeze protocol
- Self-contained HTML output template
- Selective loading rule for context budget management
