// A story's own clip on its detail page (/events/[id]) is read, not glanced at. Measured on the
// private site at d9161afd/413dd7c before this existed: the clip sat in the three-up supporting strip
// and came out 115×205 on a 390px phone and 180×320 at 1440 — playable, but a thumbnail. The page
// now gives it the whole row at its own proportions, a tall one narrowed to fit the screen height.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { PhotoGallery, videoFrameStyle } = await import("../components/photo-viewer.tsx");

const photo = (id) => ({ id, src: `/api/media/${id}?variant=web`, thumbnailSrc: `/api/media/${id}?variant=thumbnail`, alt: "一张照片", width: 1280, height: 960, type: "image" });
const clip = (id, width = 720, height = 1280) => ({ id, src: `/api/media/${id}?variant=web`, alt: "一段视频", width, height, type: "video", durationSeconds: 12 });

test("a clip's frame carries its proportions both as aspect-ratio and as --media-ar", () => {
  assert.deepEqual(videoFrameStyle({ width: 720, height: 1280 }), { aspectRatio: "720 / 1280", "--media-ar": "720 / 1280" });
  assert.deepEqual(videoFrameStyle({ width: 1920, height: 1080 }), { aspectRatio: "1920 / 1080", "--media-ar": "1920 / 1080" });
});

test("a clip without known dimensions gets no invented ratio (CSS falls back, nothing is cropped)", () => {
  assert.deepEqual(videoFrameStyle({ width: 0, height: 0 }), {});
});

test("in the supporting strip a clip keeps its aspect ratio and poster with a single initial play button", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoGallery, { photos: [photo("p1"), photo("p2"), clip("v1")], heroIndex: 0, dateLabel: "2025年8月2日" }));
  const figure = html.match(/<figure class="photo photo-video[^"]*"[^>]*>/)?.[0] ?? "";
  assert.match(figure, /aspect-ratio:720 \/ 1280/);
  assert.match(figure, /--media-ar:720 \/ 1280/);
  assert.doesNotMatch(html, /<video[^>]*controls/);
  assert.match(html, /poster="\/api\/media\/v1\?variant=poster"/);
});

test("photographs in the strip do not get --media-ar (only clips are enlarged)", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoGallery, { photos: [photo("p1"), photo("p2"), photo("p3")], heroIndex: 0, dateLabel: "2025年8月2日" }));
  assert.doesNotMatch(html, /--media-ar/);
});

test("the detail page's CSS gives a clip the whole row, capped by screen height, without cropping", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/\.detail-supporting \.photo-strip \.photo-video\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /grid-column:\s*1 \/ -1/);
  assert.match(rule, /max-height:\s*none/);
  assert.match(rule, /width:\s*min\(100%, calc\(78svh \* var\(--media-ar/);
  // object-fit on the video stays contain (set for every .photo-video), so no frame is cut.
  assert.match(css, /\.photo-video video \{[^}]*object-fit: contain/);
  // Scoped to the detail page: month pages and day groups keep their grids.
  const widened = [...css.matchAll(/([^{}]*\.photo-video)\s*\{[^}]*grid-column/g)].map((m) => m[1].trim());
  assert.deepEqual(widened, [".detail-supporting .photo-strip .photo-video"]);
});
