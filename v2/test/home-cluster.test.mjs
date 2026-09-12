// How the front page sets the photographs it can vouch for (components/home-cluster.tsx), as
// opposed to which photographs reach it (app/page.tsx picks stories whose `lead` exists and drops
// anything already shown by the cover or by 忽然想起).
//
// The change these tests guard, 2026-09-12: the block was a fixed-height row — one tile at two
// thirds of the width, a column of the rest at one third, every tile cropped by object-fit:cover to
// fill that height. It assumed three pictures. The archive hands it two, so the second was cut to
// roughly 1:2 (measured on the running private site: 111×220 beside 223×220 at a 391px viewport),
// and when the cover story took one of the two the whole block disappeared and the front page
// carried a single photograph.
//
// Every count below is a TEST SAMPLE, not production data. That is the point: one and three are
// states the real archive does not currently reach, and waiting for a random cover draw to produce
// the one-picture case would be waiting on chance rather than checking a contract. The sample
// dimensions are the real shapes involved — 480×270 is the landscape frame that was being cut, and
// 480×640 is the portrait proportion a cropped row cannot hold beside it.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// tsconfig sets jsx:"preserve" for Next, so tsx compiles these components with the classic runtime
// and their bodies call the global `React`. Next supplies it; a bare node --test run must.
globalThis.React ??= React;
const { HomeCluster } = await import("../components/home-cluster.tsx");

const sample = (id, width, height) => ({
  id: `media-${id}`,
  src: `/api/media/${id}?variant=web`,
  thumbnailSrc: null,
  width,
  height,
  type: "photo",
  posterSrc: null,
  takenAt: "2026-08-19T10:00:00.000Z",
  alt: `${id} · 一张照片`,
});

const LANDSCAPE = sample("landscape", 480, 270);
const PORTRAIT = sample("portrait", 480, 640);
const SQUARE = sample("square", 480, 480);

const render = (items) => renderToStaticMarkup(React.createElement(HomeCluster, { items }));
const items = (...media) => media.map((photo, index) => ({ id: `event-${index + 1}`, photo }));
const countOf = (markup, needle) => markup.split(needle).length - 1;

test("zero photographs draw nothing at all — no heading, no frame, no 「暂无」", () => {
  const markup = render([]);
  assert.equal(markup, "");
});

test("one photograph is drawn, and is not called 一组", () => {
  const markup = render(items(LANDSCAPE));
  assert.equal(countOf(markup, 'class="cluster-item"'), 1);
  assert.match(markup, /data-count="1"/);
  // The old gate required two and drew nothing here, which is how a front page ended up with one
  // photograph on it — the cover story's — and none below.
  assert.match(markup, /aria-label="最近的一张照片"/);
  assert.doesNotMatch(markup, /一组/);
});

test("two photographs are equal columns, each keeping its own proportions", () => {
  const markup = render(items(LANDSCAPE, PORTRAIT));
  assert.equal(countOf(markup, 'class="cluster-item"'), 2);
  assert.match(markup, /data-count="2"/);
  assert.match(markup, /aria-label="最近的照片"/);
  // Neither tile is given a size class the other is not: there is no large/small pair any more.
  assert.doesNotMatch(markup, /cluster-large|cluster-stack/);
});

test("no photograph here is cropped — the figures carry their own aspect ratios", () => {
  const markup = render(items(LANDSCAPE, PORTRAIT, SQUARE));
  // `fit="crop"` is what wrote photo-crop and handed the tile to object-fit:cover. Its absence is
  // the whole fix: the figure takes the image's ratio instead of the row's height.
  assert.doesNotMatch(markup, /photo-crop/);
  assert.match(markup, /aspect-ratio:\s*480\s*\/\s*270/);
  assert.match(markup, /aspect-ratio:\s*480\s*\/\s*640/);
  assert.match(markup, /aspect-ratio:\s*480\s*\/\s*480/);
});

test("three photographs keep the order they were given", () => {
  const markup = render(items(LANDSCAPE, PORTRAIT, SQUARE));
  assert.equal(countOf(markup, 'class="cluster-item"'), 3);
  assert.match(markup, /data-count="3"/);
  const order = [...markup.matchAll(/href="\/events\/(event-\d)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["event-1", "event-2", "event-3"]);
});

test("every tile links to the story the picture was vouched for, never to the picture", () => {
  const markup = render(items(LANDSCAPE, PORTRAIT));
  assert.equal(countOf(markup, 'href="/events/'), 2);
  assert.doesNotMatch(markup, /href="\/media\//);
});
