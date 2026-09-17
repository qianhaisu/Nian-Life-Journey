// 妈妈月报 (docs/mom-reports-implementation-handoff.md): real 苏静月报 text (lib/mom-report-content.ts),
// including the moments and food-guide sections restored on 2026-09-17 for full V1.3 fidelity. These
// tests check the module's own invariants and the tiny seam with the archive (birth date → age at
// the report's month) — not the exact prose, which is transcribed, reviewed content.
import test from "node:test";
import assert from "node:assert/strict";
import { listMomReportMonths, MOM_REPORTS } from "../lib/mom-report-content.ts";
import { buildMomReportView, resolveMomReportMonth } from "../lib/mom-report-view.ts";

const BIRTH = "2025-01-03";

test("每个月报条目里，测量点都没有虚构日期（dayKnown 恒为 false）", () => {
  for (const month of listMomReportMonths()) {
    const content = MOM_REPORTS[month];
    assert.ok(content.measurements.every((point) => point.dayKnown === false), `${month} 的测量点不该声称有具体日期`);
    assert.ok(content.measurements.length > 0, `${month} 应该至少有一个测量点`);
  }
});

test("六个方面顺序固定为：性格、健康、睡眠、饮食、运动、语言", () => {
  const content = MOM_REPORTS["2026-08"];
  assert.deepEqual(content.aspects.map((aspect) => aspect.key), ["personality", "health", "sleep", "food", "motor", "language"]);
});

test("resolveMomReportMonth: 合法月份原样返回，未知或缺省的月份回退到最新一期", () => {
  const months = listMomReportMonths();
  const latest = months[months.length - 1];
  assert.equal(resolveMomReportMonth("2026-08"), "2026-08");
  assert.equal(resolveMomReportMonth(undefined), latest);
  assert.equal(resolveMomReportMonth("2099-01"), latest, "不存在的月份不能渲染出一个假月报，只能回退");
});

test("buildMomReportView: 年龄按档案的出生日期在报告月份现算，不是写死的字符串", () => {
  const view = buildMomReportView({ birthDay: BIRTH }, "2026-08");
  assert.ok(view);
  assert.equal(view.ageLabel, "1 岁 7 个月");
  assert.equal(view.birthLabel, "2025 年 1 月 3 日");
  assert.equal(view.content.title, "张小年");
});

test("buildMomReportView: 没有出生日期时年龄留空，不猜测，正文照常渲染", () => {
  const view = buildMomReportView({ birthDay: undefined }, "2026-08");
  assert.ok(view);
  assert.equal(view.ageLabel, undefined);
  assert.equal(view.birthLabel, undefined);
});

test("身高体重曲线只用真实测量，height 里的空缺（2026-02）保持缺测而不是被抹平", () => {
  const content = MOM_REPORTS["2026-08"];
  const feb = content.measurements.find((point) => point.month === "2026-02");
  assert.equal(feb.height, null);
  assert.equal(feb.weight, 11.45);
});

test("闪光时刻：六条都是插画（V1.3 原文标注「正式插画版」），没有假称是照片的", () => {
  const content = MOM_REPORTS["2026-08"];
  assert.equal(content.moments.items.length, 6);
  for (const item of content.moments.items) {
    assert.ok(item.image.startsWith("/mom-reports/"), `${item.id} 的图片应指向本地静态资源`);
    assert.ok(!("credit" in item), `${item.id} 不该再有 photo/illustration 的字段——六条都是插画`);
  }
});

test("健康与关注：7 条平铺展示，状态用词只在 watch/later/good 三种里选", () => {
  const content = MOM_REPORTS["2026-08"];
  assert.equal(content.health.items.length, 7);
  for (const item of content.health.items) {
    assert.ok(["watch", "later", "good"].includes(item.statusTone), `${item.id} 的 statusTone 不在允许范围内`);
  }
});

test("外出小抄：四个场景各有真实图片和一句提示", () => {
  const content = MOM_REPORTS["2026-08"];
  assert.equal(content.foodGuide.scenes.length, 4);
  for (const scene of content.foodGuide.scenes) {
    assert.ok(scene.image.startsWith("/mom-reports/"));
    assert.ok(scene.tip.length > 0);
  }
});
