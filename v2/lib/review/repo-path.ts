// Repository containment for scripts that write family text. The implementation is plain JavaScript in
// scripts/lib/repo-containment.mjs so the story-review CLI can run it before any TypeScript loader
// (DATA-0914-05); this module re-exports it for TypeScript callers. See that file for the rules.
export { ContainmentError, assertOutsideRepository, findAncestorWithIdentity, findRepositoryRoot, hasRefusedWindowsForm, isInsideDirectory, isParentRelative, repositoryIdentities, resolveThroughLinks } from "../../scripts/lib/repo-containment.mjs";
