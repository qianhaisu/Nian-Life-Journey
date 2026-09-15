// The month album is read over GET (lib/month-album-request.ts): the public entry forwards only
// GET/HEAD, so a server action (POST) behind 「展开这个月其余的照片」 or 「翻开这一天的相册」 is refused
// on nianlife.cn before it reaches the app.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const { parseAlbumRequest, albumUrl, fetchFullArchiveDays, fetchDayAlbum } = await import("../lib/month-album-request.ts");

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("the album request accepts exactly what the former server actions accepted", () => {
  assert.deepEqual(parseAlbumRequest("2026", "09", null), { ok: true, year: "2026", month: "09" });
  assert.deepEqual(parseAlbumRequest("2026", "09", "2026-09-07"), { ok: true, year: "2026", month: "09", day: "2026-09-07" });
  for (const [y, m] of [["26", "09"], ["2026", "9"], ["2026", "../x"], ["abcd", "09"]]) assert.equal(parseAlbumRequest(y, m, null).ok, false, `${y}/${m}`);
  for (const day of ["2026-08-07", "2026-9-07", "2026-09-07x", ""]) assert.equal(parseAlbumRequest("2026", "09", day).ok, false, day);
});

test("the album URL stays on the public read path, never under /api/internal", () => {
  assert.equal(albumUrl("2026", "09"), "/api/memory/2026/09/album");
  assert.equal(albumUrl("2026", "09", "2026-09-07"), "/api/memory/2026/09/album?day=2026-09-07");
  assert.doesNotMatch(albumUrl("2026", "09"), /\/api\/internal\//);
});

test("both controls read with GET and return what the route answered", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method });
    const body = String(url).includes("?day=") ? { album: { day: "2026-09-07", dateLabel: "9 月 7 日", photos: [] } } : { days: [{ day: "2026-09-01", dateLabel: "9 月 1 日", photos: [] }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.equal((await fetchFullArchiveDays("2026", "09")).length, 1);
    assert.equal((await fetchDayAlbum("2026", "09", "2026-09-07"))?.day, "2026-09-07");
    globalThis.fetch = async () => new Response(JSON.stringify({ album: null }), { status: 200 });
    assert.equal(await fetchDayAlbum("2026", "09", "2026-09-30"), undefined, "no album is undefined, as before");
    globalThis.fetch = async () => new Response("Method Not Allowed", { status: 405 });
    await assert.rejects(fetchFullArchiveDays("2026", "09"), "a refused read fails loudly so the control can recover");
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET"]);
});

test("no album control calls a server action any more", () => {
  for (const file of ["components/archive-expander.tsx", "components/day-album.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /actions"/, `${file} imports no server action`);
    assert.match(source, /from "@\/lib\/month-album-request"/, `${file} reads through the GET album door`);
  }
  assert.equal(fs.existsSync(new URL("../app/memory/[year]/[month]/actions.ts", import.meta.url)), false);
  const route = read("app/api/memory/[year]/[month]/album/route.ts");
  assert.match(route, /export async function GET\(/);
  assert.doesNotMatch(route, /export (async )?function (POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(route, /use server/);
});
