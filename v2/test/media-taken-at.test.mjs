// §3（2026-09-14）：media.taken_at 是不带时区的 timestamp，所有读取方按字面日期读（calendarDayOf 直接截取）。
// 四条写入路径往里写 ISO「Z」瞬间，Postgres 丢掉 Z 存成 UTC 墙钟，6,738 行早了 8 小时；上海 00:00–07:59 的照片被放到前一天。
// 这里钉住：写入 media.taken_at 的值一律是上海墙钟；--since 的裸日期从上海零点算起。全部 fixture 合成。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calendarDayOf, sinceInstantMs, wallClockOf } from "../lib/timeline-dates.ts";
import { buildWechatMessageItem } from "../lib/ingest/wechat-import.ts";
import { loadWechatBundle } from "../lib/ingest/wechat-snapshot.ts";
import { capturedAtIso, mediaTakenAt } from "../scripts/quark-photo-apply.mjs";

test("wallClockOf：Z、+08:00、无时区三种输入，都得到上海墙钟", () => {
  assert.equal(wallClockOf("2025-05-13T01:11:44.000Z"), "2025-05-13 09:11:44", "UTC 01:11 = 上海 09:11，毫秒为 0 不带小数");
  assert.equal(wallClockOf("2026-09-10T11:12:58+08:00"), "2026-09-10 11:12:58", "+08:00 的数字原样保留");
  assert.equal(wallClockOf("2026-09-10T03:12:58+0000"), "2026-09-10 11:12:58", "无冒号偏移");
  assert.equal(wallClockOf("2025-08-05 10:19:18"), "2025-08-05 10:19:18", "无时区的值本来就是墙钟，原样返回");
  assert.equal(wallClockOf("2025-08-05T10:19:18"), "2025-08-05 10:19:18");
  assert.equal(wallClockOf("2026-09-14T03:04:05.678Z"), "2026-09-14 11:04:05.678", "毫秒保留");
  assert.equal(wallClockOf("not a time"), undefined);
  assert.equal(wallClockOf(undefined), undefined);
});

test("上海 00:00–07:59 的瞬间：写成墙钟后日期是上海当天，不再落到前一天（207 张跨日照片的形状）", () => {
  for (const [instant, shanghaiDay] of [
    ["2026-09-14T16:00:00Z", "2026-09-15"], // 上海 00:00
    ["2026-09-14T19:30:00Z", "2026-09-15"], // 上海 03:30
    ["2026-09-14T23:59:59Z", "2026-09-15"], // 上海 07:59:59
    ["2026-09-15T00:00:00Z", "2026-09-15"], // 上海 08:00
    ["2026-08-31T17:00:00Z", "2026-09-01"], // 跨月
  ]) {
    const stored = wallClockOf(instant);
    assert.equal(calendarDayOf(stored), shanghaiDay, `${instant} → ${stored}`);
    // 旧写法：Postgres 丢掉 Z 后存下的是 UTC 墙钟，读出来就是前一天（或同一天的早 8 小时）。
    assert.equal(calendarDayOf(instant.slice(0, 19).replace("T", " ")), instant.slice(0, 10), "对照：旧值按字面读是 UTC 日期");
  }
});

test("sinceInstantMs：裸日期从上海零点算起；带时间的照原样解析", () => {
  assert.equal(sinceInstantMs("2026-09-10"), Date.parse("2026-09-09T16:00:00Z"));
  assert.equal(sinceInstantMs(" 2026-09-10 "), Date.parse("2026-09-09T16:00:00Z"));
  assert.equal(sinceInstantMs("2026-09-10T11:12:58+08:00"), Date.parse("2026-09-10T03:12:58Z"));
  assert.ok(Number.isNaN(sinceInstantMs("x")));
});

test("--since 裸日期不再漏掉当天上海 00:00–07:59 的消息", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-taken-at-since-"));
  try {
    const dir = path.join(root, "texts", "conv");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "conv.md"),
      "# 家庭群\n\n- 会话ID: `12345@chatroom`\n- 会话类型: 群聊\n- 消息数量: 3\n- 导出时间: 2026\\-09\\-10 12:00:00\n- 导出工具: WeFlow\n\n---\n## 2026\\-09\\-09 23:50:00 Sender\nday before\n## 2026\\-09\\-10 03:00:00 Sender\nearly morning\n## 2026\\-09\\-10 11:12:58 Sender\nlate morning",
      "utf8");
    const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1, since: "2026-09-10" });
    assert.equal(loaded.availableMessageCount, 2, "上海 03:00 那条要算进来（旧逻辑按 UTC 零点=上海 08:00 截，只剩 1 条）；前一天 23:50 那条不算");
    assert.deepEqual(loaded.bundle.messages.map((m) => m.text), ["early morning", "late morning"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("微信导入：media.takenAt 是上海墙钟；raw_sources.capturedAt 仍是原瞬间（timestamptz 本来就对）", () => {
  const bundle = { exportSnapshot: { rootFingerprint: "root-fp", conversationDigest: "conv-digest" } };
  const message = {
    messageId: "canonical:msg-early", conversationId: "conversation:1", senderId: "sender:1", direction: "unknown",
    sentAt: "2026-09-14T19:30:00.000Z", messageType: "image", text: "", sourceLocator: { document: "session.json", recordOrdinal: 1 },
    mediaRefs: [{ id: "ref-1", relativePath: "images/a.jpg", availability: "present", checksum: `sha256:${"a".repeat(64)}`, width: 1280, height: 960, fileSize: 1000 }],
  };
  const { input } = buildWechatMessageItem(bundle, message, { profileId: "p", contributorId: "c", now: "2026-09-15T00:00:00.000Z" });
  assert.equal(input.media.length, 1);
  assert.equal(input.media[0].takenAt, "2026-09-15 03:30:00", "UTC 19:30 = 上海次日 03:30");
  assert.equal(calendarDayOf(input.media[0].takenAt), "2026-09-15");
  assert.equal(input.source.capturedAt, "2026-09-14T19:30:00.000Z", "来源时间保持瞬间写法");
  const md = buildWechatMessageItem(bundle, { ...message, messageId: "canonical:msg-md", sentAt: "2026-09-10T11:12:58+08:00" }, { profileId: "p", contributorId: "c" });
  assert.equal(md.input.media[0].takenAt, "2026-09-10 11:12:58", "markdown 路径（+08:00）结果不变");
});

test("夸克照片：media 用 capture_time 的上海墙钟，assets/来源仍用 ISO 瞬间", () => {
  const item = { capture_time: { text: "2026-05-24 03:19:31" } };
  assert.equal(mediaTakenAt(item), "2026-05-24 03:19:31", "capture_time.text 本来就是上海墙钟");
  assert.equal(calendarDayOf(mediaTakenAt(item)), "2026-05-24");
  assert.equal(capturedAtIso(item), "2026-05-23T19:19:31.000Z", "瞬间写法照旧（给 timestamptz 列）");
  assert.equal(mediaTakenAt({ capture_time: { text: "2026-05-24T11:19:31" } }), "2026-05-24 11:19:31");
});
