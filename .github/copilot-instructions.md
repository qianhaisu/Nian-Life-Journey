# Copilot Instructions

- Treat `index.html` as V1 reference material only; do not refactor it into React.
- Build V2 from a new Next.js App Router, React, TypeScript, Tailwind CSS, PostgreSQL and Drizzle ORM architecture.
- Keep V1 unchanged and preserve its history. New V2 code and data must have separate ownership boundaries.
- Prefer typed domain entities, immutable historical records, server-side authorization and explicit visibility states.
- Treat child photos, videos, health notes and family information as sensitive. Never invent, expose, or publish private data.
- Store approved media through the repository/object-storage policy in the architecture document; never use temporary external URLs.
- Use feature branches from current `main`; require Preview review before merge or production deployment.
- Use existing UI language as visual reference, but design new components from product responsibilities rather than copying the V1 DOM/CSS.
- For every data or media change, consider audit history, consent, retention, alt text, responsive behavior and rollback.
- Keep documentation and implementation concise, typed, testable and maintainable over a 5-10 year horizon.
