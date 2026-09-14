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
// Needs REPOSITORY_BACKEND=postgres set by the caller (e.g. via the RDS tunnel runner). It refuses the
// local JSON store rather than "succeeding" into a mock file. Prints ids, hash prefixes and outcomes
// only — never titles or story text; the package file holds the text and stays outside the repo.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);
const argOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const hasFlag = (name) => args.includes(`--${name}`);

if ((process.env.REPOSITORY_BACKEND ?? "").toLowerCase() !== "postgres" && !hasFlag("allow-json")) {
  console.error("REFUSED: set REPOSITORY_BACKEND=postgres (with DATABASE_URL). This script does not write to the local JSON store.");
  process.exit(1);
}
const outsideRepo = (file) => path.relative(path.resolve(process.cwd(), ".."), path.resolve(file)).startsWith("..");
const { getStoryContentVersion, recordHumanStoryDecision } = await import("../lib/db/repository.ts");
const { buildReviewPackage, applyReviewPackage } = await import("../lib/review/story-review-package.ts");
const repository = { getStoryContentVersion, recordHumanStoryDecision };

if (command === "package") {
  const events = (argOf("events") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const out = argOf("out");
  if (!events.length || !out) { console.error("--events=<id,...> and --out=<abs path>.json are required"); process.exit(1); }
  if (!outsideRepo(out)) { console.error("REFUSED: the package contains family text; write it outside the repository."); process.exit(1); }
  const { pkg, missing } = await buildReviewPackage(repository, events, new Date().toISOString());
  writeFileSync(path.resolve(out), JSON.stringify(pkg, null, 2), "utf8");
  for (const entry of pkg.entries) console.log(`${entry.eventId}  content-sha256 ${entry.contentSha256.slice(0, 16)}…`);
  if (missing.length) console.log(`missing (no such story): ${missing.join(", ")}`);
  console.log(`Package: ${path.resolve(out)} — ${pkg.entries.length} stor${pkg.entries.length === 1 ? "y" : "ies"}. Fill in "decision" per entry, then run apply.`);
} else if (command === "apply") {
  const file = argOf("package"); const operator = argOf("operator"); const promptVersion = argOf("prompt-version"); const policyVersion = argOf("policy-version");
  if (!file || !operator || !promptVersion || !policyVersion) { console.error("--package, --operator, --prompt-version and --policy-version are required"); process.exit(1); }
  const commit = hasFlag("commit");
  const outcomes = await applyReviewPackage(repository, JSON.parse(readFileSync(file, "utf8")), { operator, promptVersion, policyVersion, commit });
  for (const o of outcomes) console.log(`${o.eventId}  ${o.outcome}${o.code ? ` (${o.code})` : ""}`);
  const tally = outcomes.reduce((acc, o) => { acc[o.outcome] = (acc[o.outcome] ?? 0) + 1; return acc; }, {});
  console.log(`${commit ? "COMMIT" : "DRY RUN — nothing written"}: ${JSON.stringify(tally)}`);
  if (outcomes.some((o) => o.outcome === "stale" || o.outcome === "refused")) process.exitCode = 2;
} else {
  console.error("usage: story-review.mjs package|apply …");
  process.exit(1);
}
