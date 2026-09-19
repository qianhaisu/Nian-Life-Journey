import test from "node:test";
import assert from "node:assert/strict";
import { claimChunkReload, isChunkLoadError } from "../lib/chunk-recovery.ts";

const chunk = { name: "ChunkLoadError", message: "Loading chunk 997 failed." };
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test("stale route asset failure gets one reload, persistent failure cannot loop", () => {
  const state = storage();
  assert.equal(claimChunkReload(chunk, state, "/memory/2026/09", 1000), true);
  assert.equal(claimChunkReload(chunk, state, "/memory/2026/09", 1001), false);
  assert.equal(claimChunkReload(chunk, state, "/memory/2026/09", 60000), false);
  assert.equal(claimChunkReload(chunk, state, "/memory/2026/09", 61000), true);
});

test("ordinary render errors do not reload or write session state", () => {
  assert.equal(claimChunkReload({ message: "Cannot read properties of undefined" }, {
    getItem: () => { throw Error("should not access storage"); }, setItem: () => { throw Error("should not write"); },
  }, "/memory/2026/09"), false);
});

test("blocked or corrupt session storage fails closed", () => {
  assert.equal(claimChunkReload(chunk, { getItem: () => { throw Error("blocked"); }, setItem() {} }, "/"), false);
  assert.equal(claimChunkReload(chunk, { getItem: () => "broken", setItem() {} }, "/"), false);
  assert.equal(claimChunkReload(chunk, { getItem: () => null, setItem: () => { throw Error("quota"); } }, "/"), false);
});

test("CSS and native module load failures are recognized, generic fetch failures are not", () => {
  for (const message of ["Loading CSS chunk 1 failed.", "Failed to fetch dynamically imported module", "Importing a module script failed."]) {
    assert.equal(isChunkLoadError({ message }), true);
  }
  assert.equal(isChunkLoadError({ message: "Failed to fetch" }), false);
});
