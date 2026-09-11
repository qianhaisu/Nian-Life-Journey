// The visibility gate on the media delivery route, and the one thing it does not cover.
//
// Setting `media.visibility = 'private'` is the archive's existing way to take a picture out of
// reading delivery without touching the file. Two questions were asked of it on 2026-09-11, because
// it is about to be used on a bank transaction screenshot and an order page:
//
//   1. Does it stop a DIRECT request, not just the pages? Yes — app/api/media/[id]/route.ts answers
//      404 before it resolves a location, so no derivative of any variant is served.
//   2. Is that the whole story? No, and the gap is the cache headers, not the gate.
//
// The route itself needs a database and object storage to run, so what is tested here is the
// decision it makes, mirrored, in the same style as media-range.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

const NOT_CACHEABLE = "no-store";
const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";

// app/api/media/[id]/route.ts, lines 11 and 14, as a function.
function deliver({ visibility, hasAsset = true, variant = "web" }) {
  if (!hasAsset || visibility === "private") return { status: 404, cacheControl: NOT_CACHEABLE };
  if (variant === "original") return { status: 404, cacheControl: NOT_CACHEABLE };
  return { status: 200, cacheControl: IMMUTABLE };
}

test("a private row is refused for every variant a page URL can ask for", () => {
  for (const variant of ["web", "thumbnail", "poster", "preview", "document_preview", undefined, "nonsense"]) {
    assert.deepEqual(deliver({ visibility: "private", variant }), { status: 404, cacheControl: NOT_CACHEABLE }, String(variant));
  }
});

test("the refusal is not cacheable, so flipping a row back is visible immediately", () => {
  assert.equal(deliver({ visibility: "private" }).cacheControl, NOT_CACHEABLE);
  assert.equal(deliver({ visibility: "family" }).status, 200);
});

test("originals were never page-deliverable, private or not", () => {
  assert.equal(deliver({ visibility: "family", variant: "original" }).status, 404);
});

// THE RESIDUAL EXPOSURE, written down rather than implied.
//
// A successful response is immutable for a year, and the URL is stable — id + variant, with an ETag
// derived from the asset checksum. Nothing about flipping `visibility` changes the URL or the ETag.
// So a browser that already fetched the picture keeps its own copy and will not ask again, and any
// shared cache in front of the app would keep serving it until purged.
//
// What that does and does not mean here:
//   - The private container is loopback + SSH with no CDN, so there is no shared cache to purge.
//   - A viewer who has already opened the month page holds a private browser copy. On this
//     deployment that is three known readers on known devices; a reload clears it.
//   - The moment this is served publicly, a visibility change has to be accompanied by a purge of
//     that id's URLs. That is a deployment step, not a new subsystem.
//
// The alternative — making delivery uncacheable so revocation is instant — would cost every
// photograph on every page view, to defend against a case the archive has never had. Not taken.
test("a served picture stays cached after the row turns private, which is why revocation needs a purge", () => {
  const served = deliver({ visibility: "family" });
  assert.equal(served.cacheControl, IMMUTABLE, "already-delivered bytes are cached for a year");
  const afterFlip = deliver({ visibility: "private" });
  assert.equal(afterFlip.status, 404, "the origin refuses from now on");
  assert.notEqual(served.cacheControl, afterFlip.cacheControl,
    "but a cache that already holds the 200 was never told, so the origin's refusal is not retroactive");
});
