# Project Skills

This directory holds project-specific agent skills for Nianlife V2. All skills must follow `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, and `docs/v2-architecture.md`.

## Installed Design & Engineering Skills

- `brainstorming`: requirement clarification, option trade-offs, and design decisions.
- `frontend-design`: interface and interaction implementation.
- `react-best-practices`: React/Next.js engineering, performance, and implementation review.
- `impeccable` (`v4.3.1`): comprehensive UI/UX craft, audit, critique, harden, polish, and `live`/`generate` browser iteration.
- `make-interfaces-feel-better`: UI detail polish (concentric border radius, optical alignment, shadows vs. borders, CJK typography/wrapping, hit areas, icons) with `quick` (<= 5) and `full` (<= 15) review modes.
- `emil-design-eng`: frequency-first motion gating, purpose checks, GPU-composited `transform`/`opacity` rules, easing/duration caps, popover/tooltip timing, and `prefers-reduced-motion` policy.
- `quarkclouddrive`: Quark Cloud Drive connector workflows.
- `ui-ux-pro-max`: UI/UX design pattern reference.

> Note: `anti-ai-design` and `web-design-guidelines` were removed on 2026-09-19 per `AGENTS.md`. Their essential technical gates (CLS aspect ratios, URL state persistence, modal focus trap, reduced-motion safety, >= 44px touch targets) are folded into `DESIGN.md` and `docs/design/references/`.

## Planned Domain Skills

- `content-review`: check age, dates, units, tone, and historical-record preservation.
- `privacy-review`: check visibility, consent, child media, and health-information handling.
- `media-ingest`: validate metadata, formats, derivatives, alt text, and OSS-only storage policy.
- `release-review`: check migrations, tests, and production safeguards (`v2/scripts/deploy-ecs-public.sh`).

Skills should be added as focused `SKILL.md` files with clear triggers, inputs, outputs, and validation steps.
