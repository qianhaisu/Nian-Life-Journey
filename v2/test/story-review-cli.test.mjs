import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ContainmentError, assertOutsideRepository, findRepositoryRoot, isInsideDirectory, resolveThroughLinks } from "../scripts/lib/repo-containment.mjs";

// DATA-0914-03/05: the story-review CLI decides "inside the repository" from its own location, through
// symlinks and junctions, fails closed when a path cannot be resolved, and has no JSON-store back door.
// All refusals below happen before any repository import, so these runs never touch a database.
const V2 = process.cwd();
const REPO_ROOT = path.resolve(V2, "..");
const SCRIPT = path.join(V2, "scripts", "story-review.mjs");
const REPO = findRepositoryRoot(pathToFileURL(SCRIPT));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "story-review-cli-"));
const IN_REPO_SCRATCH = path.join(V2, ".data", `story-review-cli-${process.pid}-${Date.now()}`);
test.after(() => {
  // Remove links before their targets; never recurse through a link.
  for (const dir of [IN_REPO_SCRATCH, SCRATCH]) {
    if (!fs.existsSync(dir) && !safeLstat(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = safeLstat(full);
      if (st?.isSymbolicLink()) fs.rmSync(full, { force: true }); else fs.rmSync(full, { recursive: true, force: true });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function safeLstat(p) { try { return fs.lstatSync(p); } catch { return null; } }

function run(cwd, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.REPOSITORY_BACKEND;
  delete childEnv.DATABASE_URL;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}
const refusesAsInside = (r) => /REFUSED: the package contains family text/.test(r.stderr);
const passesPathCheck = (r) => /REFUSED: set REPOSITORY_BACKEND=postgres/.test(r.stderr);

test("parent detection: only '..' or '..'+separator is a parent; '..review' is a legal child directory", () => {
  assert.equal(isInsideDirectory("/repo/..review/x.json", "/repo", path.posix), true);
  assert.equal(isInsideDirectory("/repo/v2/..cache/x", "/repo", path.posix), true);
  assert.equal(isInsideDirectory("/repo/../x.json", "/repo", path.posix), false);
  assert.equal(isInsideDirectory("/x.json", "/repo", path.posix), false);
  assert.equal(isInsideDirectory("/repo", "/repo", path.posix), true);
  assert.equal(isInsideDirectory("/repo-other/x.json", "/repo", path.posix), false);
  assert.equal(isInsideDirectory("C:\\Nianlife\\..review\\x.json", "C:\\Nianlife", path.win32), true);
  assert.equal(isInsideDirectory("C:\\Users\\Teddy\\Nianlife\\docs\\x.json", "c:\\users\\teddy\\nianlife", path.win32), true, "case-insensitive on Windows");
  assert.equal(isInsideDirectory("D:\\review\\x.json", "C:\\Users\\teddy\\Nianlife", path.win32), false, "another drive is outside");
  assert.equal(isInsideDirectory("C:\\Users\\teddy\\NianlifeOps\\x.json", "C:\\Users\\teddy\\Nianlife", path.win32), false, "a sibling with a shared prefix is outside");
});

test("repository root comes from the script location and realpath", () => {
  assert.equal(path.resolve(REPO.literal), REPO_ROOT);
  assert.ok(fs.existsSync(path.join(REPO.real, ".git")));
  assert.throws(() => findRepositoryRoot(pathToFileURL(path.join(SCRATCH, "a", "b", "script.mjs"))), (e) => e instanceof ContainmentError && e.code === "REPOSITORY_ROOT_NOT_FOUND");
});

test("a package path inside the repository is refused from every working directory, including a legal '..review' directory", () => {
  const targets = [path.join(REPO_ROOT, "docs", "story-review-package.json"), path.join(V2, ".data", "..review", "pkg.json"), path.join(REPO_ROOT, "DOCS", "Pkg.json")];
  for (const cwd of [REPO_ROOT, V2, path.join(V2, "scripts"), os.tmpdir()]) {
    for (const out of targets) {
      const r = run(cwd, ["package", "--events=event-x", `--out=${out}`]);
      assert.equal(r.status, 1, `${cwd} ${out}`);
      assert.ok(refusesAsInside(r), `cwd=${cwd} out=${out}: ${r.stderr}`);
    }
  }
  const relative = run(path.join(V2, "scripts"), ["package", "--events=event-x", "--out=../../docs/story-review-package.json"]);
  assert.ok(refusesAsInside(relative), relative.stderr);
});

test("a legal outside path — including a directory named '..review' and missing parents — passes the path check and stops at the backend check", () => {
  const outsides = [path.join(SCRATCH, "pkg.json"), path.join(SCRATCH, "..review", "pkg.json"), path.join(SCRATCH, "new", "deeper", "pkg.json")];
  for (const cwd of [REPO_ROOT, V2, path.join(V2, "scripts")]) {
    for (const out of outsides) {
      const r = run(cwd, ["package", "--events=event-x", `--out=${out}`]);
      assert.equal(r.status, 1);
      assert.ok(passesPathCheck(r), `cwd=${cwd} out=${out}: ${r.stderr}`);
    }
  }
  assert.equal(fs.existsSync(path.join(SCRATCH, "pkg.json")), false, "nothing written before the backend check");
});

test("a link outside the repository that leads into it is refused (junction ancestor)", () => {
  const link = path.join(SCRATCH, "into-repo-docs");
  fs.symlinkSync(path.join(REPO_ROOT, "docs"), link, "junction");
  const out = path.join(link, "via-junction.json");
  assert.throws(() => assertOutsideRepository(out, REPO), (e) => e.code === "INSIDE_REPOSITORY_THROUGH_LINK");
  const r = run(V2, ["package", "--events=event-x", `--out=${out}`]);
  assert.ok(refusesAsInside(r), r.stderr);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, "docs", "via-junction.json")), false);
});

test("a link inside the repository that leads out is still refused (the written path is in the repository)", () => {
  fs.mkdirSync(IN_REPO_SCRATCH, { recursive: true });
  const link = path.join(IN_REPO_SCRATCH, "out-of-repo");
  fs.symlinkSync(SCRATCH, link, "junction");
  const r = run(V2, ["package", "--events=event-x", `--out=${path.join(link, "pkg.json")}`]);
  assert.ok(refusesAsInside(r), r.stderr);
});

test("an existing target that is itself a link into the repository is refused (directory junction; no elevation needed)", () => {
  const link = path.join(SCRATCH, "target-is-junction");
  fs.symlinkSync(path.join(REPO_ROOT, "docs"), link, "junction");
  assert.throws(() => assertOutsideRepository(link, REPO), (e) => e.code === "INSIDE_REPOSITORY_THROUGH_LINK");
  const r = run(V2, ["package", "--events=event-x", `--out=${link}`]);
  assert.ok(refusesAsInside(r), r.stderr);
});

test("an existing target that is itself a FILE link into the repository is refused (skipped only if the OS refuses to create a file symlink)", (t) => {
  const link = path.join(SCRATCH, "file-link.json");
  try {
    fs.symlinkSync(path.join(REPO_ROOT, ".gitignore"), link, "file");
  } catch (error) {
    if (error?.code === "EPERM") { t.skip("file symlinks need elevated rights on this Windows account; not changing permissions to make the test pass"); return; }
    throw error;
  }
  assert.throws(() => assertOutsideRepository(link, REPO), (e) => e.code === "INSIDE_REPOSITORY_THROUGH_LINK");
  const r = run(V2, ["package", "--events=event-x", `--out=${link}`]);
  assert.ok(refusesAsInside(r), r.stderr);
});

test("a dangling link or an unresolvable path fails closed", () => {
  const dangling = path.join(SCRATCH, "dangling");
  fs.symlinkSync(path.join(SCRATCH, "target-that-does-not-exist"), dangling, "junction");
  assert.throws(() => resolveThroughLinks(path.join(dangling, "pkg.json")), (e) => e.code === "PATH_UNRESOLVABLE");
  const r1 = run(V2, ["package", "--events=event-x", `--out=${path.join(dangling, "pkg.json")}`]);
  assert.match(r1.stderr, /REFUSED: cannot verify the package path is outside the repository \(PATH_UNRESOLVABLE\)/);
  const aFile = path.join(SCRATCH, "plain-file.txt");
  fs.writeFileSync(aFile, "x");
  const r2 = run(V2, ["package", "--events=event-x", `--out=${path.join(aFile, "child", "pkg.json")}`]);
  assert.match(r2.stderr, /REFUSED: cannot verify the package path is outside the repository \(PATH_UNRESOLVABLE\)/, "a path through a file is unresolvable");
});

test("--allow-json is not a way around the postgres requirement", () => {
  const outside = path.join(SCRATCH, "allow-json.json");
  const pkg = run(V2, ["package", "--events=event-x", `--out=${outside}`, "--allow-json"]);
  assert.match(pkg.stderr, /REFUSED: --allow-json is not supported/);
  const apply = run(V2, ["apply", `--package=${outside}`, "--operator=o", "--prompt-version=p", "--policy-version=q", "--allow-json"], { REPOSITORY_BACKEND: "json" });
  assert.match(apply.stderr, /REFUSED: --allow-json is not supported/);
  const jsonBackend = run(V2, ["apply", `--package=${outside}`, "--operator=o", "--prompt-version=p", "--policy-version=q"], { REPOSITORY_BACKEND: "json" });
  assert.match(jsonBackend.stderr, /REFUSED: set REPOSITORY_BACKEND=postgres/);
});
