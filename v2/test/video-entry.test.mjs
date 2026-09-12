// The two things a reader meets around a clip: whether the page says one is there, and whether the
// frame offers a way in and admits it when there is none.
//
// Both were measured on the running site before this existed (baseline be12989, the one playable
// clip in /memory/2025/11, desktop 1440 and a 391px phone simulation):
//
//  - The word 「视频」 appeared nowhere on that page. The group holding the clip said 「这一天的照片」.
//  - At 117 CSS px wide — that group on a 391px phone — Chrome drew no play button at all, only a
//    scrubber and an overflow dot, and only two controls were reachable by Tab. On the desktop at
//    180px it drew a play triangle and five reachable controls. Same markup, different browser
//    verdict about which controls fit, and the phone lost the one that matters.
//  - With the preview served as 404, video.error stayed null, the figure's text was empty, and
//    tapping did nothing, forever.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// tsconfig sets jsx:"preserve" for Next, so tsx compiles these components with the classic runtime
// and their bodies call the global `React`. Next supplies it; a bare node --test run must.
globalThis.React ??= React;
const { DayPhotos, dayMediaKind } = await import("../components/day-photos.tsx");
const { VideoPlayer, hasGivenUp } = await import("../components/video-player.tsx");

const photo = (id) => ({ id, src: `/api/media/${id}?variant=web`, thumbnailSrc: `/api/media/${id}?variant=thumbnail`, alt: "一张照片", width: 1280, height: 1708, type: "image" });
const clip = (id) => ({ id, src: `/api/media/${id}?variant=web`, alt: "一段视频", width: 720, height: 1280, type: "video" });

// The real row: 2025-11-22's group, six items with the clip fourth.
const REAL_DAY = [photo("a"), photo("b"), photo("c"), clip("d3d2d2df"), photo("e"), photo("f")];

test("a day of photographs is still called 照片", () => {
  assert.equal(dayMediaKind([photo("a"), photo("b")]), "照片");
});

test("a day that also holds a clip says so", () => {
  assert.equal(dayMediaKind(REAL_DAY), "照片与视频");
});

test("a day of nothing but clips is not called 照片", () => {
  assert.equal(dayMediaKind([clip("a"), clip("b")]), "视频");
});

test("media with no type at all is treated as a picture, not a clip", () => {
  assert.equal(dayMediaKind([{ id: "a" }, { id: "b" }]), "照片");
});

test("the heading and the section's accessible name name the same thing", () => {
  const html = renderToStaticMarkup(React.createElement(DayPhotos, { photos: REAL_DAY, dateLabel: "2025 年 11 月 22 日" }));
  assert.match(html, /这一天的照片与视频/);
  assert.match(html, /aria-label="2025 年 11 月 22 日的照片与视频"/);
});

test("a clip still folded away does not get named in the heading", () => {
  // The heading has to describe what is on the page. Nine photographs with the clip tenth: the
  // preview shows six, and promising a video the reader cannot see would be a promise broken.
  const photos = [...Array(9)].map((_, i) => photo(`p${i}`)).concat(clip("late"));
  const html = renderToStaticMarkup(React.createElement(DayPhotos, { photos, dateLabel: "2025 年 11 月 22 日" }));
  assert.match(html, /这一天的照片/);
  assert.doesNotMatch(html, /这一天的照片与视频/);
});

test("a group of only photographs keeps the heading it always had", () => {
  const html = renderToStaticMarkup(React.createElement(DayPhotos, { photos: [photo("a"), photo("b")], dateLabel: "2025 年 11 月 22 日" }));
  assert.match(html, /这一天的照片/);
  assert.doesNotMatch(html, /视频/);
});

test("the clip offers a real button with a name, and the native controls are still there", () => {
  const html = renderToStaticMarkup(React.createElement(VideoPlayer, { mediaId: "wechat-media:d3d2d2df", alt: "2025 年 11 月 · 一段视频" }));
  // A real <button>: focusable and operable from a keyboard without anything added for it.
  assert.match(html, /<button type="button" class="video-play"[^>]*aria-label="播放 2025 年 11 月 · 一段视频"/);
  // The native bar is not replaced. The scrubber, the volume and the overflow menu stay the
  // browser's, and the clip still plays where it sits.
  assert.match(html, /<video[^>]*controls/);
  assert.match(html, /playsInline/i);
  assert.match(html, /variant=poster/);
  assert.match(html, /<source src="\/api\/media\/wechat-media:d3d2d2df\?variant=preview" type="video\/mp4"/);
});

test("no caption track is invented", () => {
  const html = renderToStaticMarkup(React.createElement(VideoPlayer, { mediaId: "x", alt: "一段视频" }));
  assert.doesNotMatch(html, /<track/);
});

test("the frame opens offering play, not claiming to be broken", () => {
  const html = renderToStaticMarkup(React.createElement(VideoPlayer, { mediaId: "x", alt: "一段视频" }));
  assert.match(html, /video-play/);
  assert.doesNotMatch(html, /这段视频暂时打不开/);
});

// hasGivenUp is the whole of the failure decision. Everything the reader is told about a broken
// clip comes from it, so the boundary between "still working" and "gave up" is worth pinning down.
test("a clip that is still fetching is not called broken", () => {
  assert.equal(hasGivenUp({ error: null, networkState: 2 }), false); // NETWORK_LOADING
});

test("a clip buffering in the middle of playback is not called broken", () => {
  // This is the state the phone sat in for two seconds before the first frame arrived. Reporting
  // failure here would put a lie over a clip that was about to play.
  assert.equal(hasGivenUp({ error: null, networkState: 2 }), false);
  assert.equal(hasGivenUp({ error: null, networkState: 1 }), false); // NETWORK_IDLE, loaded
});

test("a clip that has not started loading is not called broken", () => {
  assert.equal(hasGivenUp({ error: null, networkState: 0 }), false); // NETWORK_EMPTY
});

test("no usable source is a failure even though the element sets no error", () => {
  // Measured: with the preview served as 404, video.error stayed null and only networkState said
  // what had happened. Watching video.error alone would have kept the frame silent.
  assert.equal(hasGivenUp({ error: null, networkState: 3 }), true); // NETWORK_NO_SOURCE
});

test("a decode error is a failure even while the network looks healthy", () => {
  // The other half: bytes arrived, the element could not play them. A source-only listener misses
  // this one entirely.
  assert.equal(hasGivenUp({ error: { code: 3 }, networkState: 1 }), true);
});
