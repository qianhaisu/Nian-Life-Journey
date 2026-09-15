// PAGE-0915-FULL-REMEDIATION-R1 B4：一个相册里好几张照片，每张的可访问名称之前都是同一句
// 「打开照片」——屏幕阅读器分不清是哪一张。alt 也常常是同一句通用描述，不够用来区分；改成
// 「打开第 N 张照片」，N 跟查看器自己的「N / 总数」计数一致。
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { PhotoGallery } = await import("../components/photo-viewer.tsx");

const photo = (id) => ({ id, src: `/api/media/${id}?variant=web`, thumbnailSrc: `/api/media/${id}?variant=thumbnail`, alt: "一张照片", width: 1280, height: 960, type: "image" });

test("有 hero 时：hero 是第 1 张，strip 里的照片依次是第 2、3、4 张——不再是重复的「打开照片」", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoGallery, { photos: [photo("a"), photo("b"), photo("c"), photo("d")], heroIndex: 0, dateLabel: "2026 年 9 月 15 日" }));
  assert.match(html, /aria-label="打开第 1 张照片"/);
  assert.match(html, /aria-label="打开第 2 张照片"/);
  assert.match(html, /aria-label="打开第 3 张照片"/);
  assert.match(html, /aria-label="打开第 4 张照片"/);
  assert.doesNotMatch(html, /aria-label="打开照片"/, "不该再留一个没有编号的旧版本");
});

test("没有 hero、纯 strip 时：照片按数组顺序从第 1 张开始编号", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoGallery, { photos: [photo("x"), photo("y")], dateLabel: "2026 年 9 月 15 日" }));
  assert.match(html, /aria-label="打开第 1 张照片"/);
  assert.match(html, /aria-label="打开第 2 张照片"/);
});

test("只有一张照片：还是第 1 张，不是裸的「打开照片」", () => {
  const html = renderToStaticMarkup(React.createElement(PhotoGallery, { photos: [photo("only")], heroIndex: 0, dateLabel: "2026 年 9 月 15 日" }));
  assert.match(html, /aria-label="打开第 1 张照片"/);
});
