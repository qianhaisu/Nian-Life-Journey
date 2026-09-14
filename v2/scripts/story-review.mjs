#!/usr/bin/env node
// The next human story decision goes through here (DATA-0914-02 P2). Two steps, the reviewed-content
// hash carried from the first to the second — see lib/review/story-review-package.ts.
//
//   1) package: read the stories, write what a person will review (content + sha256) to a file
//      OUTSIDE the repository. No database write.
//        node --import tsx scripts/story-review.mjs package --events=<id,id,...> --out=<abs path>.json
//   2) apply: after the person filled in `decision` per entry, record each decision with the
//      package's own hash. Dry run by default; --commit writes. A story that changed after the
//      package was made is refused as stale, and nothing is written for it.
//        node --import tsx scripts/story-review.mjs apply --package=<file> --operator=<name> \
//          --prompt-version=<release-...> --policy-version=<release-...> [--commit]
//
// Production CLI only: REPOSITORY_BACKEND=postgres is required and there is no way around it here
// (the JSON store is exercised by the library tests, not by this script). Prints ids, hash prefixes
// and outcomes only — never titles or story text; the package file holds the text.
//
// DATA-0914-03: the repository root is derived from THIS FILE's location (v2/scripts → repo root),
// not from the working directory, so the "outside the repository" check gives the same answer
// whichever directory the script is started from. Every path check runs before any repository import.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const [command, ...args] = process.argv.slice(2);
const argOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const hasFlag = (name) => args.includes(`--${name}`);
const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(1); };

// Inlined rather than imported from lib/review/repo-path.ts so it runs before any TypeScript loader;
// test/story-review-cli.test.mjs checks the two stay equivalent.
const isInsideDirectory = (target, root) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

if (command !== "package" && command !== "apply") { console.error("usage: story-review.mjs package|apply …"); process.exit(1); }
if (!existsSync(path.join(REPO_ROOT, ".git"))) refuse(`could not locate the repository root from the script location (${REPO_ROOT}); refusing rather than guessing.`);

let out;
if (command === "package") {
  out = argOf("out");
  if (!(argOf("events") ?? "").trim() || !out) { console.error("--events=<id,...> and --out=<abs path>.json are required"); process.exit(1); }
  if (isInsideDirectory(out, REPO_ROOT)) refuse("the package contains family text; write it outside the repository.");
}
if (hasFlag("allow-json")) refuse("--allow-json is not supported by the production CLI; JSON-store behaviour is covered by the library tests.");
if ((process.env.REPOSITORY_BACKEND ?? "").toLowerCase() !== "postgres") refuse("set REPOSITORY_BACKEND=postgres (with DATABASE_URL). This script does not write to the local JSON store.");

const { getStoryContentVersion, recordHumanStoryDecision } = await import("../lib/db/repository.ts");
const { buildReviewPackage, applyReviewPackage } = await import("../lib/review/story-review-package.ts");
const repository = { getStoryContentVersion, recordHumanStoryDecision };

if (command === "package") {
  const events = argOf("events").split(",").map((id) => id.trim()).filter(Boolean);
  const { pkg, missing } = await buildReviewPackage(repository, events, new Date().toISOString());
  writeFileSync(path.resolve(out), JSON.stringify(pkg, null, 2), "utf8");
  for (const entry of pkg.entries) console.log(`${entry.eventId}  content-sha256 ${entry.contentSha256.slice(0, 16)}…`);
  if (missing.length) console.log(`missing (no such story): ${missing.join(", ")}`);
  console.log(`Package: ${path.resolve(out)} — ${pkg.entries.length} stor${pkg.entries.length === 1 ? "y" : "ies"}. Fill in "decision" per entry, then run apply.`);
} else {
  const file = argOf("package"); const operator = argOf("operator"); const promptVersion = argOf("prompt-version"); const policyVersion = argOf("policy-version");
  if (!file || !operator || !promptVersion || !policyVersion) { console.error("--package, --operator, --prompt-version and --policy-version are required"); process.exit(1); }
  const commit = hasFlag("commit");
  const outcomes = await applyReviewPackage(repository, JSON.parse(readFileSync(file, "utf8")), { operator, promptVersion, policyVersion, commit });
  for (const o of outcomes) console.log(`${o.eventId}  ${o.outcome}${o.code ? ` (${o.code})` : ""}`);
  const tally = outcomes.reduce((acc, o) => { acc[o.outcome] = (acc[o.outcome] ?? 0) + 1; return acc; }, {});
  console.log(`${commit ? "COMMIT" : "DRY RUN — nothing written"}: ${JSON.stringify(tally)}`);
  if (outcomes.some((o) => o.outcome === "stale" || o.outcome === "refused")) process.exitCode = 2;
}
