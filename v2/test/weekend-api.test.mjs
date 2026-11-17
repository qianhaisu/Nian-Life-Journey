import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET, POST, dynamic } from "../app/api/weekend-state/route.ts";

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weekend-api-test-"));
}

async function withStateDir(fn) {
  const dir = makeTempStateDir();
  const prev = process.env.WEEKEND_STATE_DIR;
  process.env.WEEKEND_STATE_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.WEEKEND_STATE_DIR;
    else process.env.WEEKEND_STATE_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeGetRequest(query = "") {
  return new Request(`https://nianlife.cn/api/weekend-state${query}`);
}

function makePostRequest(body, headers = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://nianlife.cn/api/weekend-state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Deliberately test cross-origin & zero passcode per approved C1 policy
      Origin: "https://preview.example.com",
      ...headers,
    },
    body: raw,
  });
}

test("weekend-state route configures force-dynamic and no-store cache headers", async () => {
  assert.equal(dynamic, "force-dynamic");
  await withStateDir(async () => {
    const res = await GET(makeGetRequest("?weekId=2026-11-21"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.state.weekId, "2026-11-21");
    assert.equal(json.state.selectedProposalId, null);
    assert.equal(json.excludedExperienceTypes.length, 1);
    assert.equal(json.excludedExperienceTypes[0].experienceType, "art_museum_exhibition");
  });
});

test("GET rejects missing or invalid weekId with 400 and no-store", async () => {
  await withStateDir(async () => {
    for (const q of ["", "?weekId=bad", "?weekId=../2026-11-21", "?weekId=2026-02-30"]) {
      const res = await GET(makeGetRequest(q));
      assert.equal(res.status, 400, `expected 400 for ${q}`);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const json = await res.json();
      assert.equal(json.ok, false);
    }
  });
});

test("POST supports all four state actions without passcode and persists across GET", async () => {
  await withStateDir(async () => {
    // 1. selectProposal
    const r1 = await POST(
      makePostRequest({
        action: "selectProposal",
        weekId: "2026-11-21",
        proposalId: "2026-11-21-shanghai-jufuchang-senlan",
        departure: "sat_afternoon",
      }),
    );
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("cache-control"), "no-store");
    const j1 = await r1.json();
    assert.equal(j1.ok, true);
    assert.equal(j1.state.selectedProposalId, "2026-11-21-shanghai-jufuchang-senlan");
    assert.equal(j1.state.selectedDeparture, "sat_afternoon");

    // 2. ackFridayAlert
    const r2 = await POST(
      makePostRequest({
        action: "ackFridayAlert",
        weekId: "2026-11-21",
        adoptedSwap: true,
      }),
    );
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.equal(j2.state.fridayAlertAck.adoptedSwap, true);
    assert.ok(j2.state.fridayAlertAck.updatedAt);

    // 3. submitSundayFeedback (+ receiptKey anti-reentry)
    const r3 = await POST(
      makePostRequest({
        action: "submitSundayFeedback",
        weekId: "2026-11-21",
        outcome: "went_loved",
        tags: ["季节刚好", "不挤舒服"],
        proposalId: "2026-11-21-shanghai-jufuchang-senlan",
        receiptKey: "api-receipt-1",
      }),
    );
    assert.equal(r3.status, 200);
    const j3 = await r3.json();
    assert.equal(j3.state.sundayFeedback.outcome, "went_loved");
    assert.deepEqual(j3.state.sundayFeedback.tags, ["季节刚好", "不挤舒服"]);
    assert.deepEqual(j3.state.feedbackReceiptKeys, ["api-receipt-1"]);

    const r3Dup = await POST(
      makePostRequest({
        action: "submitSundayFeedback",
        weekId: "2026-11-21",
        outcome: "stayed_home",
        receiptKey: "api-receipt-1",
      }),
    );
    assert.equal(r3Dup.status, 200);
    const j3Dup = await r3Dup.json();
    assert.equal(j3Dup.deduplicated, true);
    assert.equal(j3Dup.state.sundayFeedback.outcome, "went_loved");

    // 4. excludeType add & remove (with and without weekId)
    const r4 = await POST(
      makePostRequest({
        action: "excludeType",
        mode: "add",
        experienceType: "noisy_indoor_mall",
        label: "吵闹室内淘气堡",
        weekId: "2026-11-21",
      }),
    );
    assert.equal(r4.status, 200);
    const j4 = await r4.json();
    assert.equal(j4.excludedExperienceTypes.length, 2);
    assert.equal(j4.state.weekId, "2026-11-21");

    const r5 = await POST(
      makePostRequest({
        action: "excludeType",
        mode: "remove",
        experienceType: "noisy_indoor_mall",
      }),
    );
    assert.equal(r5.status, 200);
    const j5 = await r5.json();
    assert.equal(j5.state, null);
    assert.equal(j5.excludedExperienceTypes.length, 1);

    // Clear selectedProposalId with null
    const r6 = await POST(
      makePostRequest({
        action: "selectProposal",
        weekId: "2026-11-21",
        proposalId: null,
      }),
    );
    assert.equal(r6.status, 200);
    const j6 = await r6.json();
    assert.equal(j6.state.selectedProposalId, null);

    // Verify GET matches persisted state
    const getRes = await GET(makeGetRequest("?weekId=2026-11-21"));
    const getJson = await getRes.json();
    assert.equal(getJson.state.selectedProposalId, null);
    assert.equal(getJson.state.fridayAlertAck.adoptedSwap, true);
    assert.equal(getJson.state.sundayFeedback.outcome, "went_loved");
    assert.equal(getJson.excludedExperienceTypes.length, 1);
  });
});

test("POST returns 400 on invalid JSON, invalid enums, invalid weekId, and oversized strings", async () => {
  await withStateDir(async () => {
    const badPayloads = [
      "{ not valid json",
      [],
      { action: "unknownAction", weekId: "2026-11-21" },
      { action: "selectProposal", weekId: "../bad", proposalId: "p1" },
      { action: "selectProposal", weekId: "2026-11-21", proposalId: "" },
      { action: "selectProposal", weekId: "2026-11-21", proposalId: "x".repeat(121) },
      { action: "selectProposal", weekId: "2026-11-21", proposalId: "p1", departure: "night" },
      { action: "ackFridayAlert", weekId: "2026-11-21", adoptedSwap: "yes" },
      { action: "submitSundayFeedback", weekId: "2026-11-21", outcome: "made_up" },
      { action: "submitSundayFeedback", weekId: "2026-11-21", outcome: "went_loved", tags: ["x".repeat(49)] },
      {
        action: "submitSundayFeedback",
        weekId: "2026-11-21",
        outcome: "went_loved",
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
      },
      { action: "excludeType", mode: "toggle", experienceType: "art" },
      { action: "excludeType", mode: "add", experienceType: "   " },
      { action: "excludeType", mode: "add", experienceType: "ok", label: "x".repeat(81) },
      { action: "excludeType", mode: "add", experienceType: "ok", weekId: "2026-02-30" },
    ];

    for (const payload of badPayloads) {
      const res = await POST(makePostRequest(payload));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(payload)}`);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const json = await res.json();
      assert.equal(json.ok, false);
    }
  });
});
