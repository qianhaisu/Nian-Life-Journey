import test from "node:test";
import assert from "node:assert/strict";
import { countContentKeys, normalizeWechatText, selectUnarchivedOrdinals, shanghaiDateDaysAgo, wechatContentKey } from "../lib/ingest/wechat-content-dedupe.ts";

const msg = (ordinal, sentAt, text) => ({ sentAt, text, sourceLocator: { recordOrdinal: ordinal } });

test("markdown escaping, image references and whitespace do not change the key", () => {
  assert.equal(normalizeWechatText("好的\\[强\\]  \n谢谢"), "好的[强]谢谢");
  assert.equal(normalizeWechatText("![photo](media/images/a.jpg)"), "");
  // the same instant written by the two parsers: .md with +08:00, .json as UTC
  assert.equal(wechatContentKey("2026-09-14T08:45:05+08:00", "早上好\\!"), wechatContentKey("2026-09-14T00:45:05.000Z", "早上好!"));
  // a media-only message: .md keeps an image reference, .json keeps no text at all
  assert.equal(wechatContentKey("2026-09-14T09:00:00+08:00", "![](texts/c/media/x.jpg)"), wechatContentKey("2026-09-14T01:00:00.000Z", ""));
});

test("an archived row's [media] placeholder matches the transcript's image reference", () => {
  // raw_sources.text is stored through wechat-import.ts sanitizeText, which writes "[media]"
  const stored = wechatContentKey(new Date("2026-09-14T00:45:05.000Z"), "\n[media]\n");
  assert.equal(stored, wechatContentKey("2026-09-14T08:45:05+08:00", "\n![图片](media/images/a.jpg)\n"));
  assert.equal(wechatContentKey(new Date("2026-09-14T00:45:05.000Z"), "看\n[media]\n"), wechatContentKey("2026-09-14T08:45:05+08:00", "看\n![](media/images/a.jpg)\n"));
});

test("a different second or different text is a different key", () => {
  assert.notEqual(wechatContentKey("2026-09-14T08:45:05+08:00", "a"), wechatContentKey("2026-09-14T08:45:06+08:00", "a"));
  assert.notEqual(wechatContentKey("2026-09-14T08:45:05+08:00", "a"), wechatContentKey("2026-09-14T08:45:05+08:00", "b"));
  assert.throws(() => wechatContentKey("not a date", "a"), /WECHAT_CONTENT_KEY_INVALID_TIME/);
});

test("only messages the archive does not already hold are selected", () => {
  const archived = countContentKeys([{ sentAt: "2026-09-13T08:22:37.000Z", text: "已经在库里" }]);
  const doc = [msg(1, "2026-09-13T16:22:37+08:00", "已经在库里"), msg(2, "2026-09-14T08:45:05+08:00", "新的一天")];
  const result = selectUnarchivedOrdinals(doc, archived);
  assert.deepEqual([...result.ordinals], [2]);
  assert.equal(result.alreadyArchived, 1);
});

test("identical messages are counted, not collapsed", () => {
  const archived = countContentKeys([{ sentAt: "2026-09-14T00:00:01.000Z", text: "[强]" }]);
  const doc = [msg(7, "2026-09-14T08:00:01+08:00", "\\[强\\]"), msg(8, "2026-09-14T08:00:01+08:00", "\\[强\\]")];
  assert.deepEqual([...selectUnarchivedOrdinals(doc, archived).ordinals], [8]);
});

test("a message present in both the .md and the .json is selected once across one run", () => {
  const archived = countContentKeys([]);
  const md = [msg(3, "2026-09-14T22:49:33+08:00", "晚安")];
  const json = [msg(912, "2026-09-14T14:49:33.000Z", "晚安")];
  assert.deepEqual([...selectUnarchivedOrdinals(md, archived).ordinals], [3]);
  const second = selectUnarchivedOrdinals(json, archived);
  assert.equal(second.ordinals.size, 0);
  assert.equal(second.alreadyArchived, 1);
});

test("since-days is a Shanghai calendar date", () => {
  // 2026-09-15 23:30 Shanghai = 15:30Z
  assert.equal(shanghaiDateDaysAgo(0, new Date("2026-09-15T15:30:00Z")), "2026-09-15");
  assert.equal(shanghaiDateDaysAgo(3, new Date("2026-09-15T15:30:00Z")), "2026-09-12");
  // 2026-09-16 00:30 Shanghai is already the 16th even though UTC is still the 15th
  assert.equal(shanghaiDateDaysAgo(0, new Date("2026-09-15T16:30:00Z")), "2026-09-16");
  assert.throws(() => shanghaiDateDaysAgo(-1), /WECHAT_SINCE_DAYS_INVALID/);
});
