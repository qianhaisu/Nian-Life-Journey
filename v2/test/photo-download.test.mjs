import test from "node:test";
import assert from "node:assert/strict";
import { downloadPhoto } from "../scripts/editor/download-photo.mjs";

test("photo download writes only a nonempty image response", async () => {
  let written;
  const result = await downloadPhoto("https://example.invalid/photo", "unused", {
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }),
    writeFile: (_file, bytes) => { written = bytes; },
  });
  assert.deepEqual(result, { ok: true, status: 200 });
  assert.deepEqual([...written], [1, 2, 3]);
});
test("missing derivatives, server failures and HTML successes remain diagnostic failures", async () => {
  for (const [response, reason, status] of [
    [new Response("private response", { status: 404 }), "http", 404],
    [new Response("private response", { status: 503 }), "http", 503],
    [new Response("login page", { headers: { "content-type": "text/html" } }), "not-image", 200],
    [new Response(null, { headers: { "content-type": "image/webp" } }), "empty-image", 200],
  ]) {
    const result = await downloadPhoto("unused", "unused", { fetchImpl: async () => response, writeFile: () => assert.fail("must not write") });
    assert.deepEqual(result, { ok: false, status, reason });
    assert.ok(!JSON.stringify(result).includes("private"));
  }
});
test("network, timeout, stream and disk failures are distinguished without logging sensitive errors", async () => {
  for (const name of ["TypeError", "TimeoutError"]) {
    const result = await downloadPhoto("unused", "unused", { fetchImpl: async () => { throw Object.assign(new Error("secret"), { name }); } });
    assert.deepEqual(result, { ok: false, status: null, reason: name === "TimeoutError" ? "timeout" : "network" });
  }
  const badStream = { ok: true, status: 200, headers: new Headers({ "content-type": "image/webp" }), arrayBuffer: async () => { throw new Error("secret"); } };
  assert.deepEqual(await downloadPhoto("unused", "unused", { fetchImpl: async () => badStream }), { ok: false, status: 200, reason: "body-read" });
  assert.deepEqual(await downloadPhoto("unused", "unused", { fetchImpl: async () => new Response("image", { headers: { "content-type": "image/webp" } }), writeFile: () => { throw new Error("secret"); } }), { ok: false, status: 200, reason: "file-write" });
});
