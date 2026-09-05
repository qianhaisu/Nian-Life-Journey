# A 轨交接稿

> **这份文档只能覆盖写，不能追加。** 它永远只描述"现在"，长度保持在 100 行以内。
> 历史在 `git log` 和 `docs/STATUS.md` 里，不在这。一个刚清空上下文的 Session 只读这一份就能接着干。
>
> 最后更新：2026-09-05 13:1x · by Claude Code（接手 session，接上一个 ba15c6 和 nianlife-b9）

---

## 1 · 我是谁，我管什么

A 轨 = 写库轨。管数据管线：导入、写手、主体门、分级、月度回顾、性能、本地 worker。

**我拥有的文件**（可以随便改）
```
v2/scripts/**        v2/lib/organizer/**      v2/lib/db/**
v2/.env.local        docs/ORCHESTRATOR-INBOX.md    docs/STATUS.md    docs/HANDOFF-A.md
```

**B 轨拥有的，我不碰**
```
v2/components/**     v2/app/**/page.tsx       v2/app/globals.css
v2/lib/publication-moments.ts     docs/ORCHESTRATOR-INBOX-B.md    docs/STATUS-B.md    docs/HANDOFF-B.md
```

**Git**：直接在 main 上做；`git add` 只加自己的文件，**绝不 `git add -A`**；commit 前 `git pull --rebase`；
撞上 `.git/index.lock` 是 B 轨在提交，等 10 秒重试，别删。

---

## 2 · 现在做到哪了

**P1 进度（INBOX 11:0x 版本的看板，最新状态）**

| # | 任务 | 状态 | 关键 commit |
|---|---|---|---|
| P1-0 | 2026 全年过 T7 管线 | ✅ 五个月完成（01 月 5 天/0 章节级，内容本身薄） | ba15c6 session |
| P1-5 | 索引 + getMonthArchive scoped read | ✅ 完全做完（含 page.tsx 侧，B 轨协作） | 8459502 + ca9c38d |
| P1-1 | conversationId 稳定性修复 | ✅ 修完 + 预注册 9 个 post-fix ID | 2e38e5a + 86f174e |
| P1-snap | 月度回顾 bullet 化 | ✅ 数据+渲染全部到位（v2 格式 + B 轨 <ul><li>） | e304b07 + 7fda35b |
| P1-2 | 夸克 1,690 张历史照片入库 | **到达当前工具链上限（214/1,690）** 见下 | fdd8df3 + 51dcf0b |
| P1-3 | 主体门 + T20-C 收编 | ⬜ 未开始，等 Cowork 派单 | — |
| P1-4 | 图文同日绑定（信任名单制） | ⬜ 未开始（P1-3 之后） | — |
| P1-6 | 本地 worker | ⬜ 未开始（排最后） | — |

**P1-2 说明**（不是卡住，是遇到了真实的工具链上限）：
1,690 张中 87%（1,468 张）是 HEIC 格式；这台机器的 libvips/libheif（vips 8.18.6 / libheif 1.23.2）
在 `createDerivatives()` 时报 `heif: Decoder plugin generated an error`，即使 `sourceImageMetadata()`
能读取元数据，Windows WIC 也能打开。**不是文件损坏，是这台机器的解码器不支持。**
已过滤到 `C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\manifests\heic-decode-unsupported.jsonl`
（1,468 行），未来换解码器后可直接拿这个文件续跑，不必重新扫描整个 manifest。
222 张非 HEIC 候选中有 8 张 checksum 已存在（另一批次入库过），实际新增 214 条。
**P1-2b（HEIC 解码）**是单独任务，Cowork 安排，不在当前 A 轨范围。

**P1-2 误报说明**（2026-09-05 12:4x Cowork 巡检那条）：巡检用了 `LIKE '%Quark%'` 查出 321 条，
是把目标批次（214）和另一个不相关的旧批次 `Quark 照片初始化`（107）加在一起了，不是新的崩溃。
已由 nianlife-b9 在 STATUS.md 和 commit 1eb61b6 里纠正。

**P1-0：01 月不达标（5 天/0 章节级）** 是真实内容薄，不是模型问题（pro 重跑过，仍不达标）。
由 Cowork/Teddy 判断是否放宽，A 轨不自行动阈值。

---

## 3 · 下一件事

**等 Cowork 派 P1-3（主体门 + 收编 T20-C 分类器）**。

P1-3 的验收必须检查内容量下限：收紧主体门后，生产中仍需 ≥8 天有文字 + ≥1 章节级。低于下限说明门太严。

**如果 Cowork 的 INBOX 里已经有 P1-3 的具体指令，直接看 INBOX 顶部看板执行，不用等。**

---

## 4 · 不要再踩的坑

1. **`REPOSITORY_BACKEND` 不设会静默写进本地 JSON**（`v2/.data/nian-life.json`），终端照样打印
   "WRITTEN"。写库脚本必须在文件里硬编码 `process.env.REPOSITORY_BACKEND = "postgres"`。
2. `organizer-month-write.mjs` 的 `--out` 必须是**仓库外**的绝对路径。
3. **匿名发言人要按"一类规则"查，不是词表**：「家人」「家里人」「有人说」「有人问」「大家说」
   「长辈」「亲戚」「家属」都是同一个违规，`narrative-validator.ts` 的 `GENERIC_FAMILY_COLLECTIVE`
   已经改成这类规则模式。
4. **月度回顾是二次生成的**：改了 `life_events` 不会自动改 `monthly_snapshot`，都要扫、
   改完源头后重跑 `month-review.mjs --commit`。
5. **切换 `AI_MODEL` 重跑一个月，必须加 `--force`**：去重键与模型无关，不加会全部跳过，等于白跑。
6. **flash 有时会漏掉必填数组字段**（`TypeError` 崩进程）——已在 `narrative-validator.ts` 全部加
   `?? []`（commit 9eae6eb），再遇到新崩溃去查有没有新的未保护字段访问。
7. 验收看数据，不看进程状态。"终端打印出来了" ≠ "数据库里有了"。
8. **巡检 / 查进度时不要用 `LIKE '%Quark%'`**：会把多个批次加在一起，用精确 `source_label = '...'`。

---

## 5 · 我不能单方面做的

- 删数据、删行（`store_only` 是"不发布"，不是删）
- 改 B 轨的文件（`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、`v2/lib/publication-moments.ts`）
- 为了让数字达标而手动把 `store_only` 改回 approved
- 放宽主体门 / 分级阈值（低于内容量下限时如实报告，由 Cowork/Teddy 判断）
- 接 P1 以外的任务

---

=== A 轨已到收尾节点，可以 /clear ===
