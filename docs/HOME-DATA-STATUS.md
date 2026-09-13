# HOME-20260913-DATA · 数据轨状态

任务 ID：HOME-20260913-DATA　独占文件：本文件（不写 `docs/HOME-PAGE-STATUS.md`）
接手 HEAD：`74e7686`（派单卡记的 `ac90ec6` 已被取代，未回退 checkout）
非本轮的既有未提交改动，不代改不代提交：`docs/HANDOFF-COMMANDER.md`、`docs/ORCHESTRATOR-INBOX.md`、
`docs/nianlife-handoff-2026-09-06-neon.md`、`v2/scripts/quark-heic-ingest-linux.mjs`

## ✅ CONTRACT_READY · 2026-09-13 18:4x (+08:00)

接口位置 **`v2/lib/home-feed.ts`**，版本常量 `HOME_FEED_VERSION = "home-feed/1.0.0"`。
**SHA：见本文件同一次 commit（push 后补写在下面「Git」一节）。**
页面轨可以接线；后续只做兼容新增，不改已有字段含义。

### 入口（页面只需要这两个）

```ts
readHomeFeed(options?: BuildHomeFeedOptions): Promise<HomeFeed>   // SSR 用
buildHomeFeed(archive, options?): HomeFeed                        // 纯函数，测试用
```

`BuildHomeFeedOptions`：`{ now?, edition?, quality?, upcoming?, upcomingSources?, photoKey? }`。
页面正常只传 `photoKey`（「换张照片」时把候选的 `key` 传回来）。

### 数据块与状态语义

| 字段 | 语义 / 空值含义 |
|---|---|
| `version` | 契约版本串，页面可断言 |
| `clock` | `today`（Asia/Shanghai 日历日）、`todayLabel`、`birthDay?`、`ageToday?`。**和选中的故事日期完全无关**；`ageToday` 为 undefined = 出生日期未知，不猜 |
| `edition` | `id`（`"2026-09-13#2"`）、`startedAt`/`expiresAt`（带 `+08:00`）、`slot` 0..3、`index`。6 小时一期，纯函数，无 `Math.random()`、无 cookie |
| `lead?` | `{ story, photo?, photoAbsence? }`。`photo` 为空时 `photoAbsence` **一定**有值：`reviewed_no_photo`（有人判过这段不配图）/ `no_reviewed_binding`（挂着照片但无人审过这一对）/ `no_media_at_all`（本来就没附件）。**不要画空照片框，不要借别的故事的照片** |
| `leadAbsence?` | `lead` 为空时一定有值，`{ kind, reason }`。窗口内没有已发布记忆时 kind = `empty_material` |
| `photoCandidates` | 最多 6 条，每条 `{ key, photo, story, chosen, reason }`。**切换单位是 (故事, 照片) 对**——换图必然连带换标题/日期/链接。`reason` 写明为什么选中/没选中（轮换位次、连拍同组、冷却缩短） |
| `recentFact?` | 0–1 条 `HomeStoryRef`，**保证不与 `lead.story` 同一 eventId** |
| `reminders` | 三态联合：`ready`（`shown` 默认 1 条、有关键事项时最多 2 条；`more` 折叠可达；`retired` 退场原因）/ `clear`（真读完整窗口才有）/ `unavailable`（`kind`: `empty_material` / `not_extracted` / `read_failed`）。**`unavailable` 与 `clear` 绝不可渲染成同一句话** |

`HomeStoryRef` = `{ eventId, href("/events/<id>"), title, excerpt?, day, dateLabel, ageLabel?, monthHref }`。
`HomeFeedPhoto` = `{ media: MediaRef, use, approval, day, dateLabel, ageLabel?, quality? }`。
`HomeReminder` = `{ id, title, state, item, deadlineLabel, reason, important, detail?, evidenceHref?, provenance? }`。
状态文案用导出的 `HOME_REMINDER_LABEL`，**页面不自拟**。

### 读取说明（CLAUDE.md 渲染路径那条）

不新增任何读取，逐字复用首页今天已有的三次：`loadFamilyArchiveOnDemand()`（300s 记忆化，1 或 0 次）
＋ `readHomeUpcoming()`（3 小查询）＋ `readHomeUpcomingSources()`（仅在前者 ready 时 2 小查询）。
**没有 `raw_sources`、没有无 LIMIT 整表查询、没有 `getStore()`/`getOrganizerStore()`、没有新表、没有迁移。
SSR 里没有任何模型调用**——质量分从 `quality` 注入，离线算好后缓存。

### 本轮已落实的规则

- 配图门槛：只认 `memory.lead`（= `storyDisplayMedia`，逐 (eventId,mediaId) 的 `media_binding=approved`，Basis C）。**不看 trusted、不看同日、不看 confirmed 扁平集合**；`media_subject_check` 与 `media_binding` 在契约里是两种批准，不互相代替。未改 visibility、未写任何审核行。
- 过滤顺序：先滤掉不合格的**再**分连拍组（抄 2026-09-13 `photoLedMoment` 的教训），有测试守着「被挡在后面的那张审核过的照片仍能当头图」这个假阴性。
- 撤销优先于期次：候选每次从当前 archive 现算，期次不缓存 mediaId。同一 `edition.id` 在撤回后落到另一张仍合格的图上（有测试）。
- 冷却：同图 14 天 / 同事件 3 天写成常量；候选不足时**缩短为整轮轮换**，理由逐条写进 `candidate.reason`，门槛一格没放。
- 质量分：`quality` 查不到**或抛错**都降级为确定性分并写明 `degraded`，`source` 只有 `ai_vision` / `deterministic` 两种，**没有伪造的第三种**。`interaction` 在降级分里恒为 0——那一项元数据看不出来，留 0 让「还没评过」在分数里看得见。
- 待办：过期 → `expired`，**不默认露出，也不写成完成**，库里那一行一个字没动；关键事项（接种/就诊词表）排最前、过期也不消失；`superseded` 独立成态；同源重放逐字幂等。

### 已知未交付（不藏在「已实现」里）

1. **AI 视觉评估尚未执行**。当前所有候选的 `quality.source === "deterministic"`，`degraded` 写明原因。
   视觉能力可用性尚未确认，下一步先确认再跑有界批次（≤30 张、连续失败 3 次停）。
2. **待办保鲜的时间维度只做到「过了日子」**。§6.2 的「无期限临时采购 48 小时 / 库存预测 72 小时」、
   §6.3 的「习惯提醒 7 天、最多两个日期」尚未按起算点（原始事项的提出时间，不是导入时间）实现——
   因此 8 月 16 日的「买鸡蛋」目前仍靠 `needs_confirmation` 排序压在折叠里，**没有按 48 小时退场**。下一步就做这条。
3. **生产核验未完成**。`v2/.env.local` 指向的 Neon 是**另一份更小的数据**（651 life_events / 898 reviews），
   线上私有站跑的是阿里云 RDS（快照口径 845 / 1636）。本机没有 ECS 的 `.pem`，`netstat` 上也只有 18080，
   **无法直连生产库**。本轮真实核验因此走两条可得的证据：生产快照 `slots-055e919.json`（2026-09-13T09:47Z 采自生产）
   与 `http://127.0.0.1:18080/` 的实际渲染结果。这是**限制，不是通过**。

## Git

- 2026-09-13 18:11 申请，18:4x 持有：首个 Git + 全量构建时段（共同规格 §3，数据轨优先）。页面轨已在其 STATUS 写明让出。
- 本次只精确暂存本轨三个文件：`v2/lib/home-feed.ts`、`v2/test/home-feed.test.mjs`、`docs/HOME-DATA-STATUS.md`。
  页面轨那 8 个未提交/未跟踪文件（`globals.css`、`layout.tsx`、`photo-viewer.tsx`、`home-*.tsx`、`fonts.css`、`home.css`、`public/fonts/`、`build-round-font.py`）**一个都没碰、没提交**。
- 检查（当前树，含页面轨半成品一起编译通过）：typecheck ✅　lint ✅　测试 **1046 条 1036 通过 0 失败 10 跳过**（新增 27 条）✅　`npm run build` ✅
- 未部署、未写库、未迁移、未改任何审核状态。

## 给页面轨的答复

- 契约已冻结，可以接线。`readHomeFeed()` 直接在 `app/page.tsx` 里 `await`。
- `reminders.status === "unavailable"` 时请**什么都不画**（或画一句说明状态的话），**不要**画成「没有待办」；
  `clear` 才可以说「已检查」，并且请把 `windowFrom` 印出来。
- `photoAbsence` 有值时请渲染纯文字版，不要留占位框。
- 「换张照片」把 `candidate.key` 回传 `readHomeFeed({ photoKey })`；标题/日期/链接请一律从返回的 `lead.story` 读，**不要**只换 `img`。
- 你改共享文件（`layout.tsx`、`globals.css`、`components/*`）时我不会去扫；写「可以测了 + SHA」后我再测完整呈现链。

## 下一步（数据轨）

1. 待办保鲜的时间维度（48h 采购 / 72h 库存 / 7 天习惯，起算点用原始提出时间）+ 退场证据输出。
2. 确认实际可用的视觉能力；可用则跑 ≤30 张有界批次并落盘缓存，不可用则保持确定性降级并如实标注。
3. 有界真实核验，候选与退场原因落 `C:\Users\teddy\NianlifeOps\home-2026-09-13\data\`（不进 Git）。
