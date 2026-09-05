# A 轨交接稿

> **这份文档只能覆盖写，不能追加。** 它永远只描述"现在"，长度保持在 100 行以内。
> 历史在 `git log` 和 `docs/STATUS.md` 里，不在这。一个刚清空上下文的 Session 只读这一份就能接着干。
>
> 最后更新：2026-09-05 14:1x · by Claude Code（接手 session）

---

## 1 · 我是谁，我管什么

A 轨 = 写库轨。管数据管线：导入、写手、主体门、分级、月度回顾、性能、本地 worker。

**我拥有的文件**（可以随便改）
```
v2/scripts/**        v2/lib/organizer/**      v2/lib/db/**
v2/.env.local        docs/ORCHESTRATOR-INBOX.md    docs/STATUS.md    docs/HANDOFF-A.md
v2/lib/family-archive.ts   v2/lib/trusted-photo-sources.ts   v2/lib/home-view.ts
```

**B 轨拥有的，我不碰**
```
v2/components/**     v2/app/**/page.tsx       v2/app/globals.css
v2/lib/publication-moments.ts     docs/ORCHESTRATOR-INBOX-B.md    docs/STATUS-B.md    docs/HANDOFF-B.md
```

**Git**：直接在 main 上做；`git add` 只加自己的文件，**绝不 `git add -A`**；commit 前 `git pull --rebase`；
撞上 `.git/HEAD.lock` 先等 30 秒（b9 在提交）；0 字节锁超过 30 秒可以删。

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
| P1-3 | 主体门 + T20-C 收编 | ✅ 完成（gradeMonthEvents 共享模块，writer 自动调用） | f8b009e |
| P1-4 | 图文同日绑定（信任名单制） | ✅ 完成（trusted-photo-sources.ts，主群加入信任名单） | e47a4c0 |
| P1-6 | 本地 worker | ⬜ 未开始（排最后） | — |

**P1-2 说明**（不是卡住，是遇到了真实的工具链上限）：
1,690 张中 87%（1,468 张）是 HEIC 格式；这台机器的 libvips/libheif 在 `createDerivatives()` 时报错，
sourceImageMetadata() 能读元数据，Windows WIC 也能打开，不是文件损坏，是 Node 解码器限制。
已过滤到 `heic-decode-unsupported.jsonl`（1,468 行）。**P1-2b（HEIC 解码）**是单独任务，给新 A 轨 session。

**P1-4 架构说明**：
- `lib/trusted-photo-sources.ts` → `isTrustedPhotoSource()` = 信任名单的唯一入口
- 信任名单：Quark album（`sourceType="family_photo"`）+ 乳儿班群（DAYCARE_CONVERSATION）+ 主群三个 ID
- `family-archive.ts` 的 `mediaPrivilegeOf` 改用 `isTrustedPhotoSource`，两个读路径（getStore + getMonthArchive）自动覆盖
- 无 schema 改动，无 AI 判断

---

## 3 · 下一件事

**先读 INBOX 顶部看板**，确认是否有比 P1-4 之后更急的任务。

已知待做（如果 INBOX 无更急优先级）：
- **P1-4 视觉验收**：打开 2026-07 月页（Quark 照片最多，204 张），确认 Quark 照片和文字并排
- **P1-6（本地 worker）**：INBOX 里最后的 P1 任务

---

## 4 · 不要再踩的坑

1. **`REPOSITORY_BACKEND` 不设会静默写进本地 JSON**（`v2/.data/nian-life.json`），终端照样打印 "WRITTEN"。写库脚本必须硬编码。
2. `organizer-month-write.mjs` 的 `--out` 必须是**仓库外**的绝对路径。
3. **匿名发言人要按"一类规则"查**，不是词表。
4. **月度回顾是二次生成的**：改了 `life_events` 不会自动改 `monthly_snapshot`。
5. **切换 `AI_MODEL` 重跑一个月，必须加 `--force`**：去重键与模型无关。
6. **flash 有时会漏掉必填数组字段**——已在 `narrative-validator.ts` 全部加 `?? []`。
7. 验收看数据，不看进程状态。"终端打印出来了" ≠ "数据库里有了"。
8. **巡检/查进度时不要用 `LIKE '%Quark%'`**：会把多个批次加在一起。
9. **T20-C 分级现在是自动的**（P1-3）：`organizer-month-write.mjs --commit` 结束时自动运行 `gradeMonthEvents`。
10. **HEAD.lock = 0 字节且超过 30 秒未变化 = 可以删**（先等 30 秒确认是否 b9 在用）。

---

## 5 · 我不能单方面做的

- 删数据、删行
- 改 B 轨文件（`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、`v2/lib/publication-moments.ts`）
- 为了让数字达标而手动把 `store_only` 改回 approved
- 放宽主体门/分级阈值
- 接 P1 以外的任务

---

=== A 轨已到收尾节点，可以 /clear ===
