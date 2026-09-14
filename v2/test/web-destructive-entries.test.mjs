import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// DATA-0914-03: no unauthenticated web entry may reach a destructive story write. The capture page's
// `undoCapture` server action (unlink sources / delete a story, no identity check) was removed; this
// pins that nothing under app/ or components/ calls the Repository's undo, and that the action is gone.

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no page, route, action or component references undoOrganization", () => {
  const offenders = [...sourceFiles(path.join(process.cwd(), "app")), ...sourceFiles(path.join(process.cwd(), "components"))]
    .filter((file) => /\bundoOrganization\b/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));
  assert.deepEqual(offenders, []);
});

test("the capture server actions no longer export undoCapture", () => {
  const actions = readFileSync(path.join(process.cwd(), "app", "actions.ts"), "utf8");
  assert.doesNotMatch(actions, /export\s+(async\s+)?function\s+undoCapture\b/);
  assert.doesNotMatch(actions, /export\s+(const|let|var)\s+undoCapture\b/);
  const exported = [...actions.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported, ["captureSources"], "the only server action in app/actions.ts is the upload");
});
