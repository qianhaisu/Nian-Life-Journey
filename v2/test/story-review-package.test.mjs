import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createJsonRepository } from "../lib/db/json-repository.ts";
import { applyReviewPackage, buildReviewPackage, validateReviewPackageEntry } from "../lib/review/story-review-package.ts";

// P2 (2026-09-14): the human decision entrance carries the hash of what the person READ.
// Uses the JSON repository with the same restore convention as repository-contract.test.mjs.
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => { if (originalStore) await writeFile(dataFile, originalStore); else await rm(dataFile, { force: true }); });

const PROFILE_ID = "profile-contract-test-fixture";
const uid = (p) => `${p}-${randomUUID()}`;
const NOW = "2026-11-02T00:00:00.000Z";
const APPLY = { operator: "review-test-human", promptVersion: "release-review-test", policyVersion: "release-review-test" };

async function candidate(repo) {
  const source = { id: uid("source"), profileId: PROFILE_ID, sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: "2026-11-01T10:00:00.000Z", importedAt: "2026-11-01T10:00:00.000Z", mediaIds: [], sourceLabel: "review test", visibility: "family", status: "uploaded" };
  await repo.appendUpload({ source, media: [] });
  const fp = uid("fp");
  const event = { id: uid("event"), profileId: PROFILE_ID, title: "Review test", story: "reviewed words", occurredAt: "2026-11-01", people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [source.id], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "trace", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "ai", organizationFingerprint: fp };
  await repo.persistOrganization([source.id], event, [], { actor: "organizer", review: { id: uid("qr"), profileId: PROFILE_ID, targetKind: "life_event", targetId: event.id, decision: "needs_human_review", reasonCodes: [], provider: "deepseek", promptVersion: "writer-review-test", policyVersion: "t7", reviewFingerprint: uid("rf"), reviewedAt: "2026-11-01T10:00:00.000Z" } });
  return { repo, source, event, fp };
}
const decide = (pkg, decision) => ({ ...pkg, entries: pkg.entries.map((entry) => ({ ...entry, decision })) });

test("a package approval applies once, bound to the reviewed hash, and a rerun is idempotent", async () => {
  const { repo, event } = await candidate(createJsonRepository());
  const { pkg, missing } = await buildReviewPackage(repo, [event.id, "event-does-not-exist"], NOW);
  assert.deepEqual(missing, ["event-does-not-exist"]);
  const filled = decide(pkg, "approved");
  assert.deepEqual(await applyReviewPackage(repo, filled, { ...APPLY, commit: false }), [{ eventId: event.id, outcome: "would_write" }], "dry run");
  assert.equal(await repo.findQualityReview("life_event", event.id, APPLY.promptVersion), null, "a dry run writes nothing");
  assert.deepEqual(await applyReviewPackage(repo, filled, { ...APPLY, commit: true }), [{ eventId: event.id, outcome: "written" }]);
  const row = await repo.findQualityReview("life_event", event.id, APPLY.promptVersion);
  assert.equal(row.decision, "approved");
  assert.ok(row.reasonCodes.includes(`content-sha256:${pkg.entries[0].contentSha256}`));
  assert.deepEqual(await applyReviewPackage(repo, filled, { ...APPLY, commit: true }), [{ eventId: event.id, outcome: "idempotent" }]);
});

test("a late approval of text that changed after the package was made is refused and writes nothing", async () => {
  const { repo, event, fp, source } = await candidate(createJsonRepository());
  const { pkg } = await buildReviewPackage(repo, [event.id], NOW);
  // The Organizer rewrites the still-unreviewed story while the person is reading the package.
  await repo.persistOrganization([source.id], { ...event, story: "rewritten after the package", organizationFingerprint: fp }, [], { actor: "organizer" });
  const filled = decide(pkg, "approved");
  assert.deepEqual(await applyReviewPackage(repo, filled, { ...APPLY, commit: false }), [{ eventId: event.id, outcome: "stale", code: "STALE_REVIEW_CONTENT" }]);
  assert.deepEqual(await applyReviewPackage(repo, filled, { ...APPLY, commit: true }), [{ eventId: event.id, outcome: "stale", code: "STALE_REVIEW_CONTENT" }]);
  assert.equal(await repo.findQualityReview("life_event", event.id, APPLY.promptVersion), null);
  assert.equal((await repo.getStoryProtection(event.id)).protected, false, "nothing became protected");
});

test("an entry whose text or hash was edited in the file is refused; an undecided entry is skipped", async () => {
  const { repo, event } = await candidate(createJsonRepository());
  const { pkg } = await buildReviewPackage(repo, [event.id], NOW);
  const tamperedText = { ...pkg, entries: [{ ...pkg.entries[0], decision: "approved", content: { ...pkg.entries[0].content, story: "edited in the package" } }] };
  assert.equal(validateReviewPackageEntry(tamperedText.entries[0]), "ENTRY_CONTENT_HASH_MISMATCH");
  assert.deepEqual(await applyReviewPackage(repo, tamperedText, { ...APPLY, commit: true }), [{ eventId: event.id, outcome: "refused", code: "ENTRY_CONTENT_HASH_MISMATCH" }]);
  const pastedHash = { ...pkg, entries: [{ ...pkg.entries[0], decision: "approved", contentSha256: "f".repeat(64) }] };
  assert.deepEqual(await applyReviewPackage(repo, pastedHash, { ...APPLY, commit: true }), [{ eventId: event.id, outcome: "refused", code: "ENTRY_CONTENT_HASH_MISMATCH" }]);
  assert.deepEqual(await applyReviewPackage(repo, pkg, { ...APPLY, commit: true }), [{ eventId: event.id, outcome: "skipped_no_decision" }]);
  assert.equal(await repo.findQualityReview("life_event", event.id, APPLY.promptVersion), null);
  await assert.rejects(() => applyReviewPackage(repo, { entries: [] }, { ...APPLY, commit: true }), /PACKAGE_MALFORMED/);
});
