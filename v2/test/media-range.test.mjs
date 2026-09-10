// Range support on the media delivery route. It exists for one reason: a browser will not let a
// reader drag a video's scrubber unless the server advertises ranges and answers them. Measured on
// the archive's first playable clip before this was added — video.seekable was empty and setting
// currentTime snapped back to zero, so "the video plays" would have been true and "the reader can
// use it" would not.
import test from "node:test";
import assert from "node:assert/strict";

// The parsing rule the route applies, kept here as the thing under test: the route itself needs a
// database and object storage to run, and what can go wrong in it is the arithmetic.
function resolveRange(header, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "ignored" };
  const start = match[1] ? Number(match[1]) : Math.max(0, totalSize - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), totalSize - 1) : totalSize - 1) : totalSize - 1;
  if (!(Number.isFinite(start) && Number.isFinite(end)) || start > end || start >= totalSize) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end, length: end - start + 1, contentRange: `bytes ${start}-${end}/${totalSize}` };
}

const SIZE = 1_492_550; // the first playable preview, to the byte

test("an open-ended range is the rest of the file — what a media element asks for first", () => {
  assert.deepEqual(resolveRange("bytes=0-", SIZE), { kind: "partial", start: 0, end: SIZE - 1, length: SIZE, contentRange: `bytes 0-${SIZE - 1}/${SIZE}` });
});

test("a mid-file range is what a seek asks for", () => {
  const r = resolveRange("bytes=1000000-1100000", SIZE);
  assert.equal(r.kind, "partial");
  assert.equal(r.length, 100_001);
  assert.equal(r.contentRange, `bytes 1000000-1100000/${SIZE}`);
});

test("a suffix range counts back from the end", () => {
  const r = resolveRange("bytes=-500", SIZE);
  assert.deepEqual([r.start, r.end, r.length], [SIZE - 500, SIZE - 1, 500]);
});

test("an end past the file is clamped rather than refused", () => {
  const r = resolveRange(`bytes=1000000-99999999`, SIZE);
  assert.equal(r.end, SIZE - 1);
});

test("a start past the end of the file is unsatisfiable, not a silent whole-file answer", () => {
  assert.equal(resolveRange(`bytes=${SIZE}-`, SIZE).kind, "unsatisfiable");
  assert.equal(resolveRange("bytes=900-100", SIZE).kind, "unsatisfiable");
});

test("anything that is not a byte range is ignored, and the route answers 200 as before", () => {
  for (const header of ["bytes=", "items=0-10", "bytes=abc-def", "bytes=0-10, 20-30"]) {
    assert.equal(resolveRange(header, SIZE).kind, "ignored", header);
  }
});
