import test from "node:test";
import assert from "node:assert/strict";
import { detectMilestone, emphasisWithMilestone } from "../lib/milestones.ts";

// 2026-09-23 第三轮 5.2：只认文字里写明了的里程碑。句子取自 2025-12 已发布的写法（合成改写，不含私人内容）。
const k = (day, ...texts) => detectMilestone(day, texts)?.kind ?? null;

test("第一次走路、出牙、开口叫人、第一次出远门", () => {
  assert.equal(k("2025-12-25", "迈出了独立走路的第一步"), "walk");
  assert.equal(k("2025-12-24", "练走路", "雪姨说「迈出了第一步！」"), "walk");
  assert.equal(k("2025-12-08", "长高了，第八颗牙冒出来"), "tooth");
  assert.equal(k("2025-06-01", "长出了第一颗小牙"), "tooth");
  assert.equal(k("2025-09-01", "第一次开口叫妈妈"), "words");
  assert.equal(k("2025-10-01", "他会叫爸爸了"), "words");
  assert.equal(k("2025-12-02", "要跟妈妈去合肥，第一次坐火车"), "trip");
  assert.equal(k("2025-12-02", "第一次自己用勺子"), "first");
});

test("出生与生日按日期认，不看文字", () => {
  assert.deepEqual(detectMilestone("2025-01-03", []), { kind: "birth", badge: "出生" });
  assert.deepEqual(detectMilestone("2026-01-03", ["剃了头"]), { kind: "birthday", badge: "1 岁生日" });
  assert.equal(detectMilestone("2026-01-04", ["满一周岁后的第二天"]), null);
});

test("普通的一天不命中：说话、吃饭、看牙医之类的字眼不误判", () => {
  for (const t of ["妈妈说「今天咋样」", "中午啃排骨", "雪姨说他牙床有点红", "外公说「慢慢开步！」", "他走来走去看汽车"]) assert.equal(k("2025-12-10", t), null, t);
});

test("手写 quiet 压过里程碑；手写 lead 照旧；里程碑自动抬", () => {
  const m = detectMilestone("2025-12-25", ["迈出了第一步"]);
  assert.equal(emphasisWithMilestone("quiet", m), "quiet");
  assert.equal(emphasisWithMilestone("lead", null), "lead");
  assert.equal(emphasisWithMilestone(undefined, m), "lead");
  assert.equal(emphasisWithMilestone("bogus", null), undefined);
});
