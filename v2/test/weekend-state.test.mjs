import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContainmentError } from "../lib/review/repo-path.ts";
import { WeekendStateError, WeekendStateStore } from "../lib/weekend/state-store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(v2Root, "..");

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weekend-state-test-"));
}

test("excluded-types.json defaults to art_museum_exhibition, deduplicates add, and persists remove", async () => {
  const dir = makeTempStateDir();
  try {
    const store = new WeekendStateStore(dir);
    const initial = await store.readExcludedTypes();
    assert.deepEqual(initial, [
      {
        experienceType: "art_museum_exhibition",
        label: "美术馆/艺术展",
        excludedAt: "2026-11-17T00:10:00.000Z",
        addedBy: "family_rule",
      },
    ]);

    // Deduplicates existing default type
    const afterDupDefault = await store.updateExcludedType({
      mode: "add",
      experienceType: "art_museum_exhibition",
      label: "美术馆/艺术展",
      addedBy: "teddy",
    });
    assert.equal(afterDupDefault.length, 1);

    // Add new type twice -> deduplicated
    await store.updateExcludedType({
      mode: "add",
      experienceType: "steep_mountain",
      label: "爬山/连续台阶",
      addedBy: "sujing",
    });
    const afterDupNew = await store.updateExcludedType({
      mode: "add",
      experienceType: "steep_mountain",
      label: "爬山/连续台阶",
    });
    assert.equal(afterDupNew.length, 2);

    // Remove both (including default) -> persists [] rather than reviving default
    await store.updateExcludedType({ mode: "remove", experienceType: "steep_mountain" });
    const afterRemoveDefault = await store.updateExcludedType({
      mode: "remove",
      experienceType: "art_museum_exhibition",
    });
    assert.deepEqual(afterRemoveDefault, []);
    assert.deepEqual(await store.readExcludedTypes(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects invalid weekId and path traversal attempts", async () => {
  const dir = makeTempStateDir();
  try {
    const store = new WeekendStateStore(dir);
    for (const bad of ["../2026-11-21", "..\\evil", "2026-11-21.json", "2026-02-30", "2026-13-01", "1999-01-01", ""]) {
      await assert.rejects(
        store.readWeekState(bad),
        (err) => err instanceof WeekendStateError && err.code === "INVALID_WEEK_ID",
        `readWeekState should reject ${bad}`,
      );
      await assert.rejects(
        store.selectProposal({ weekId: bad, proposalId: "p1" }),
        (err) => err instanceof WeekendStateError && err.code === "INVALID_WEEK_ID",
        `selectProposal should reject ${bad}`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assertOutsideRepository blocks writes inside repository and through junctions into repository", async () => {
  const insideDir = path.join(v2Root, ".tmp-forbidden-weekend-state");
  const outsideDir = makeTempStateDir();
  const junctionDir = path.join(outsideDir, "via-junction-into-repo");
  try {
    const insideStore = new WeekendStateStore(insideDir);
    await assert.rejects(
      insideStore.selectProposal({ weekId: "2026-11-21", proposalId: "p1" }),
      (err) => err instanceof ContainmentError && err.code === "INSIDE_REPOSITORY",
    );
    await assert.rejects(
      insideStore.updateExcludedType({ mode: "add", experienceType: "test_type", label: "Test" }),
      (err) => err instanceof ContainmentError && err.code === "INSIDE_REPOSITORY",
    );
    assert.equal(fs.existsSync(insideDir), false, "no directory created inside repo");

    fs.symlinkSync(path.join(repoRoot, "docs"), junctionDir, "junction");
    const junctionStore = new WeekendStateStore(path.join(junctionDir, "weekend-state"));
    await assert.rejects(
      junctionStore.selectProposal({ weekId: "2026-11-21", proposalId: "p1" }),
      (err) => err instanceof ContainmentError && err.code === "INSIDE_REPOSITORY_THROUGH_LINK",
    );

    const lockSymlinkDir = makeTempStateDir();
    try {
      fs.symlinkSync(path.join(repoRoot, "docs"), path.join(lockSymlinkDir, "weekend-state.lock"), "junction");
      const lockLinkStore = new WeekendStateStore(lockSymlinkDir);
      await assert.rejects(
        lockLinkStore.selectProposal({ weekId: "2026-11-21", proposalId: "p1" }),
        (err) => err instanceof ContainmentError && err.code === "INSIDE_REPOSITORY_THROUGH_LINK",
      );
    } finally {
      fs.rmSync(lockSymlinkDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(insideDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("feedbackReceiptKeys prevents duplicate Sunday feedback submission re-entry", async () => {
  const dir = makeTempStateDir();
  try {
    const store = new WeekendStateStore(dir);
    const t1 = new Date("2026-11-22T12:00:00.000Z");
    const t2 = new Date("2026-11-22T12:05:00.000Z");

    const first = await store.submitSundayFeedback({
      weekId: "2026-11-21",
      outcome: "went_loved",
      tags: ["季节刚好", "不挤舒服", "季节刚好"],
      proposalId: "2026-11-21-shanghai-jufuchang-senlan",
      receiptKey: "sun-receipt-1",
      now: t1,
    });
    assert.equal(first.deduplicated, false);
    assert.equal(first.state.sundayFeedback.submittedAt, t1.toISOString());
    assert.deepEqual(first.state.sundayFeedback.tags, ["季节刚好", "不挤舒服"]);
    assert.deepEqual(first.state.feedbackReceiptKeys, ["sun-receipt-1"]);

    // Retry with same receiptKey -> deduplicated, original timestamp & outcome kept
    const retry = await store.submitSundayFeedback({
      weekId: "2026-11-21",
      outcome: "went_pitfall",
      tags: ["人太多排队"],
      proposalId: "other",
      receiptKey: "sun-receipt-1",
      now: t2,
    });
    assert.equal(retry.deduplicated, true);
    assert.equal(retry.state.sundayFeedback.outcome, "went_loved");
    assert.equal(retry.state.sundayFeedback.submittedAt, t1.toISOString());
    assert.deepEqual(retry.state.feedbackReceiptKeys, ["sun-receipt-1"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("crash before rename leaves state file untouched; orphan temps and stale locks are reclaimed", async () => {
  const dir = makeTempStateDir();
  try {
    const store = new WeekendStateStore(dir);
    await store.selectProposal({ weekId: "2026-11-21", proposalId: "initial-p", departure: "sat_morning" });

    const crashing = new WeekendStateStore(dir, { failBeforeRename: true });
    await assert.rejects(
      crashing.selectProposal({ weekId: "2026-11-21", proposalId: "crashed-p" }),
      /injected failure before rename/,
    );
    const afterCrash = await store.readWeekState("2026-11-21");
    assert.equal(afterCrash.selectedProposalId, "initial-p");

    // Simulate dead process lock (owner.json with dead PID or stale ownerless lock dir)
    const lockDir = path.join(dir, "weekend-state.lock");
    await mkdir(lockDir);
    await writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ token: "dead-token", pid: 9999999, host: os.hostname(), startedAt: Date.now() - 120_000 }),
    );
    const quick = new WeekendStateStore(dir, { staleLockMs: 500, lockTimeoutMs: 5000 });
    const recovered = await quick.ackFridayAlert({ weekId: "2026-11-21", adoptedSwap: true });
    assert.equal(recovered.fridayAlertAck.adoptedSwap, true);

    // Also test stale ownerless lock directory
    await mkdir(lockDir);
    const old = new Date(Date.now() - 120_000);
    await utimes(lockDir, old, old);
    const recovered2 = await quick.selectProposal({ weekId: "2026-11-21", proposalId: "recovered-p" });
    assert.equal(recovered2.selectedProposalId, "recovered-p");

    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp") || f === "weekend-state.lock");
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("10 concurrent worker processes racing on the same week state and excluded-types lose zero updates", async () => {
  const dir = makeTempStateDir();
  const stateStoreUrl = pathToFileURL(path.join(v2Root, "lib", "weekend", "state-store.ts")).href;
  const workerScript = `
    import { WeekendStateStore } from ${JSON.stringify(stateStoreUrl)};
    const [dir, idx] = process.argv.slice(1);
    const store = new WeekendStateStore(dir, { lockTimeoutMs: 20000 });
    await store.submitSundayFeedback({
      weekId: "2026-11-21",
      outcome: "went_loved",
      tags: ["tag-" + idx],
      proposalId: "prop-" + idx,
      receiptKey: "concurrent-key-" + idx,
    });
    await store.updateExcludedType({
      mode: "add",
      experienceType: "concurrent_type_" + idx,
      label: "并发类型-" + idx,
      addedBy: "teddy",
    });
  `;

  try {
    const runWorker = (i) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", workerScript, dir, String(i)],
          { cwd: v2Root, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`worker ${i} exited ${code}: ${stderr}`));
        });
      });

    await Promise.all(Array.from({ length: 10 }, (_, i) => runWorker(i)));

    const store = new WeekendStateStore(dir);
    const state = await store.readWeekState("2026-11-21");
    const excluded = await store.readExcludedTypes();

    assert.equal(state.feedbackReceiptKeys.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.ok(state.feedbackReceiptKeys.includes(`concurrent-key-${i}`), `missing concurrent-key-${i}`);
      assert.ok(excluded.some((item) => item.experienceType === `concurrent_type_${i}`), `missing concurrent_type_${i}`);
    }
    assert.equal(excluded.length, 11); // 1 default + 10 concurrent additions

    const rawWeek = await readFile(path.join(dir, "2026-11-21.json"), "utf8");
    const rawExcluded = await readFile(path.join(dir, "excluded-types.json"), "utf8");
    assert.doesNotThrow(() => JSON.parse(rawWeek));
    assert.doesNotThrow(() => JSON.parse(rawExcluded));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
