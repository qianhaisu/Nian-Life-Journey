import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { isInsideDirectory } from "../lib/review/repo-path.ts";

// DATA-0914-03: the story-review CLI decides "inside the repository" from its own location, and has
// no JSON-store back door. The refusals below all happen before any repository import, so these runs
// never touch a database.
const V2 = process.cwd();
const REPO_ROOT = path.resolve(V2, "..");
const SCRIPT = path.join(V2, "scripts", "story-review.mjs");

function run(cwd, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.REPOSITORY_BACKEND;
  delete childEnv.DATABASE_URL;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

test("isInsideDirectory: nested, sibling, parent-escape, Windows case and cross-drive", () => {
  assert.equal(isInsideDirectory("/repo/docs/x.json", "/repo", path.posix), true);
  assert.equal(isInsideDirectory("/repo", "/repo", path.posix), true);
  assert.equal(isInsideDirectory("/repo-other/x.json", "/repo", path.posix), false);
  assert.equal(isInsideDirectory("/repo/v2/../../elsewhere/x.json", "/repo", path.posix), false);
  assert.equal(isInsideDirectory("C:\\Users\\Teddy\\Nianlife\\docs\\x.json", "c:\\users\\teddy\\nianlife", path.win32), true, "case-insensitive on Windows");
  assert.equal(isInsideDirectory("D:\\review\\x.json", "C:\\Users\\teddy\\Nianlife", path.win32), false, "another drive is outside");
  assert.equal(isInsideDirectory("C:\\Users\\teddy\\NianlifeOps\\x.json", "C:\\Users\\teddy\\Nianlife", path.win32), false, "a sibling with a shared prefix is outside");
});

test("a package path inside the repository is refused from every working directory", () => {
  const inside = path.join(REPO_ROOT, "docs", "story-review-package.json");
  for (const cwd of [REPO_ROOT, V2, path.join(V2, "scripts"), os.tmpdir()]) {
    const r = run(cwd, ["package", "--events=event-x", `--out=${inside}`]);
    assert.equal(r.status, 1, cwd);
    assert.match(r.stderr, /REFUSED: the package contains family text/, `cwd=${cwd}`);
  }
  // relative spelling from v2/scripts that lands in the repository docs
  const r = run(path.join(V2, "scripts"), ["package", "--events=event-x", "--out=../../docs/story-review-package.json"]);
  assert.match(r.stderr, /REFUSED: the package contains family text/);
});

test("a package path outside the repository passes the path check and then stops at the backend check", () => {
  const outside = path.join(os.tmpdir(), "story-review-cli-test.json");
  for (const cwd of [REPO_ROOT, V2, path.join(V2, "scripts")]) {
    const r = run(cwd, ["package", "--events=event-x", `--out=${outside}`]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REFUSED: set REPOSITORY_BACKEND=postgres/, `cwd=${cwd}`);
  }
});

test("--allow-json is not a way around the postgres requirement", () => {
  const outside = path.join(os.tmpdir(), "story-review-cli-test.json");
  const pkg = run(V2, ["package", "--events=event-x", `--out=${outside}`, "--allow-json"]);
  assert.match(pkg.stderr, /REFUSED: --allow-json is not supported/);
  const apply = run(V2, ["apply", `--package=${outside}`, "--operator=o", "--prompt-version=p", "--policy-version=q", "--allow-json"], { REPOSITORY_BACKEND: "json" });
  assert.match(apply.stderr, /REFUSED: --allow-json is not supported/);
  const jsonBackend = run(V2, ["apply", `--package=${outside}`, "--operator=o", "--prompt-version=p", "--policy-version=q"], { REPOSITORY_BACKEND: "json" });
  assert.match(jsonBackend.stderr, /REFUSED: set REPOSITORY_BACKEND=postgres/);
});
