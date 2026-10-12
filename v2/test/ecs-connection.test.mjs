import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EcsConnectionError, resolveEcsConnection } from "../scripts/lib/ecs-connection.mjs";

const home = path.join(tmpdir(), "ecs-identity-test-home");
const currentKey = path.join(home, ".ssh", "nianlife-prod-ecs.pem");
const legacyKey = path.join(home, "Downloads", "nianlife-prod-ecs.pem");

test("the scheduled editor defaults to the current user's .ssh identity", () => {
  const checked = [];
  const connection = resolveEcsConnection({ env: {}, home, exists: (file) => {
    checked.push(file);
    return file === currentKey || file === legacyKey;
  } });
  assert.deepEqual(connection, { ssh: "ecs-user@47.99.243.155", key: currentKey });
  assert.deepEqual(checked, [currentKey]);
});

test("explicit ECS_KEY and ECS_SSH override defaults, including an intentional legacy key", () => {
  const checked = [];
  const connection = resolveEcsConnection({ env: { ECS_KEY: legacyKey, ECS_SSH: "ops@configured-host" }, home, exists: (file) => {
    checked.push(file);
    return file === legacyKey;
  } });
  assert.deepEqual(connection, { ssh: "ops@configured-host", key: legacyKey });
  assert.deepEqual(checked, [legacyKey]);
});

test("a missing explicit key fails without testing available default identities", () => {
  const missingKey = path.join(home, "configured-but-missing.pem");
  const checked = [];
  assert.throws(() => resolveEcsConnection({ env: { ECS_KEY: missingKey }, home, exists: (file) => {
    checked.push(file);
    return file === currentKey || file === legacyKey;
  } }), (error) => {
    assert.ok(error instanceof EcsConnectionError);
    assert.equal(error.code, "ECS_KEY_MISSING");
    assert.ok(error.message.includes(missingKey));
    assert.match(error.message, /Configured ECS_KEY/);
    return true;
  });
  assert.deepEqual(checked, [missingKey]);
});

test("a missing .ssh key never silently falls back to the Downloads identity", () => {
  const checked = [];
  assert.throws(() => resolveEcsConnection({ env: {}, home, exists: (file) => {
    checked.push(file);
    return file === legacyKey;
  } }), (error) => {
    assert.equal(error.code, "ECS_KEY_MISSING");
    assert.ok(error.message.includes(currentKey));
    assert.match(error.message, /Set ECS_KEY/);
    return true;
  });
  assert.deepEqual(checked, [currentKey]);
});

test("an explicitly empty ECS_KEY fails before checking the filesystem", () => {
  for (const key of ["", " ", "\t"]) {
    assert.throws(() => resolveEcsConnection({ env: { ECS_KEY: key }, home, exists: () => assert.fail("invalid configuration must not inspect alternatives") }), {
      name: "EcsConnectionError",
      code: "ECS_KEY_INVALID",
    });
  }
});

test("the real filesystem check requires a file and never reads its contents", (t) => {
  const fixtureHome = mkdtempSync(path.join(tmpdir(), "nianlife-ecs-identity-"));
  t.after(() => rmSync(fixtureHome, { recursive: true, force: true }));
  const fixtureKey = path.join(fixtureHome, ".ssh", "nianlife-prod-ecs.pem");
  mkdirSync(path.dirname(fixtureKey), { recursive: true });

  assert.throws(() => resolveEcsConnection({ env: {}, home: fixtureHome }), { code: "ECS_KEY_MISSING" });
  writeFileSync(fixtureKey, "test fixture, not a private key");
  assert.equal(resolveEcsConnection({ env: {}, home: fixtureHome }).key, fixtureKey);
  assert.throws(() => resolveEcsConnection({ env: { ECS_KEY: path.dirname(fixtureKey) }, home: fixtureHome }), {
    code: "ECS_KEY_MISSING",
  });
});
