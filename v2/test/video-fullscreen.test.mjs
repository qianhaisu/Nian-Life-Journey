// requestFullscreen() picks an interface and reports refusal (components/video-player.tsx).
//
// These are LOGIC tests against fake elements. They prove which interface is chosen and that a
// refusal is surfaced rather than swallowed. They do NOT prove a real browser went fullscreen —
// that is a browser check, recorded separately, and no assertion here should be read as one.
import test from "node:test";
import assert from "node:assert/strict";
import { requestFullscreen } from "../components/video-player.tsx";

const frameWith = (names) => Object.fromEntries(names.map((name) => [name, async () => {}]));

test("the standard interface on the frame is preferred when the browser has it", async () => {
  const calls = [];
  const frame = { requestFullscreen: async () => { calls.push("standard"); } };
  const video = { webkitEnterFullscreen: () => { calls.push("ios"); } };
  assert.equal(await requestFullscreen(frame, video), true);
  assert.deepEqual(calls, ["standard"], "only one request is made");
});

test("iOS Safari's video-only interface is used when the frame has none", async () => {
  const calls = [];
  const video = { webkitEnterFullscreen: () => { calls.push("ios"); } };
  assert.equal(await requestFullscreen({}, video), true);
  assert.deepEqual(calls, ["ios"]);
});

test("a refused standard request falls through to the next interface", async () => {
  const calls = [];
  const frame = { requestFullscreen: async () => { calls.push("standard"); throw new Error("refused"); } };
  const video = { webkitEnterFullscreen: () => { calls.push("ios"); } };
  assert.equal(await requestFullscreen(frame, video), true);
  assert.deepEqual(calls, ["standard", "ios"]);
});

test("a browser with no fullscreen interface at all reports refusal instead of throwing", async () => {
  assert.equal(await requestFullscreen({}, {}), false);
  assert.equal(await requestFullscreen(null, null), false);
});

test("every interface refusing reports refusal, so the page can offer the button again", async () => {
  const frame = { requestFullscreen: async () => { throw new Error("no"); } };
  const video = { webkitEnterFullscreen: () => { throw new Error("no"); } };
  assert.equal(await requestFullscreen(frame, video), false);
});

test("the webkit-prefixed frame interface is accepted too", async () => {
  assert.equal(await requestFullscreen(frameWith(["webkitRequestFullscreen"]), {}), true);
});
