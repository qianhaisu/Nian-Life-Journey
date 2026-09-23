import test from "node:test";
import assert from "node:assert/strict";
import { buildDayPack, resolveParagraphSources, UNREGISTERED } from "../scripts/editor/day-pack.mjs";
import { checkDecision } from "../scripts/editor/plan.mjs";

// 2026-09-23：重写已有照片的天时的材料。合成数据。
const rows = [
  { id: "m1", t: "09:12", text: "看看今天", speaker: "妈妈", mediaIds: ["ph-1"] },
  { id: "m2", t: "09:13", text: "[图片]", speaker: "爸爸", mediaIds: ["ph-2"] },
  { id: "m3", t: "10:00", text: "他没感觉", speaker: null, mediaIds: [] },
  { id: "m4", t: "11:00", text: "[图片]", speaker: "妈妈", mediaIds: ["not-selected"] },
];
const photos = [{ mediaId: "ph-1", description: "一名幼儿坐在推车里", firstScreen: true }, { mediaId: "ph-2", description: "一位女士抱着幼儿", firstScreen: false }];

test("未登记的人在材料里写成「未登记的人」；只带未选照片的占位消息不进材料", () => {
  const pack = buildDayPack({ rows, photos });
  assert.equal(pack.keys.size, 3);
  assert.match(pack.text, new RegExp(`s3 10:00 ${UNREGISTERED}: 他没感觉`));
  assert.doesNotMatch(pack.text, /11:00/);
});

test("照片带着发来它的那条消息：p 键在 sources 里换成那条消息", () => {
  const pack = buildDayPack({ rows, photos });
  assert.match(pack.text, /p2［由 s2 爸爸 发来］画面：一位女士抱着幼儿/);
  assert.match(pack.text, /s2 09:13 爸爸: （发来照片\/视频 p2）/);
  const src = resolveParagraphSources(["p2", "s2", "p1"], pack);
  assert.deepEqual(src.map((s) => s.id), ["m2", "m1"]);
  assert.equal(src[0].text, "", "占位消息没有正文，引语不会从它里面找到");
});

test("checkDecision：重写时允许 visual-description，夜间编辑默认不允许", () => {
  const d = { decision: "write", kind: "visual-description", title: "推车里", paragraphs: [{ text: "他坐在推车里。", sources: ["p1"] }] };
  assert.equal(checkDecision(d, new Set(["p1"])).ok, false);
  assert.equal(checkDecision(d, new Set(["p1"]), { kinds: ["story", "text-only", "visual-description"] }).ok, true);
});
