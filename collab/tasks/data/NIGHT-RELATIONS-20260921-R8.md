# NIGHT-RELATIONS-20260921-R8 出生前故事事实修正与自动审阅收口

- line: data
- status: accepted
- round: 8
- branch: main
- base_sha: d111e73a88d4b8b9cee9600aba52a3761dd36bc8
- depends_on: NIGHT-RELATIONS-20260921-R7
- merge_order: main current branch only
- objective: 修正 3 条出生前故事中的无来源推断，并让月度 Organizer 写入后默认执行代理语义审阅；Teddy 不承担内容审核。
- allowed_paths: `v2/lib/organizer/semantic-review.ts`; `v2/scripts/organizer-month-write.mjs`; R7/R8 专用数据修正脚本；本任务结果文件；必要的 `v2/app/memory/page.tsx` 出生日期判断。
- forbidden: 新分支；删除历史记录；覆盖无关改动；把待修正内容批准；伪造 provider/model；要求 Teddy 去 `/inbox` 审故事；扩大导入范围。
- eta: 2026-09-22 18:00 +08:00
- next_check: 2026-09-22 17:45 +08:00
- push_policy: 完成后仅提交并 push 本任务文件到当前 main。
- stop_conditions: 数据删除、不可恢复覆盖、额外费用、生产部署；部署仍由 Codex 在验收后处理。

## 已核实的生产事实

1. `93914a2f-c6ec-460e-b086-866a23396dea` 当前正文含“泰德陪着她，一起等结果”，原始来源没有陪伴或一起等待证据。更严重的是来源“我去医院了”的 senderDigest 当前解析为爸爸，不能写成“那天她去了医院”。删除这两个断言，保留有据的：妈妈期待 NT、NT 后准备公开宣布、爸爸当天说自己去了医院。人物字段可保留妈妈、爸爸，但正文必须准确标明各自说了什么。
2. `2ecb20ca-c6dc-4b8e-9c35-dc0b0df0a177` 原文只有妈妈问证件风险、爸爸说“可能成为最后一批合法美宝”。“证件还没到手”“心里悬着”“有人说”“安静地等一个确定答案”均非直接证据。改成克制的有据叙述；标题也不要把未证实的等待状态写成事实。保留不确定词“可能”。
3. `52a28aea-ec18-41a5-a8ec-d84b0ededb18` 两条消息均为妈妈转述：“她说 B 超看胎儿很健康”“胎心监护结果也很健康”。“苏静和泰德听到这些，心里踏实了”无证据，删除；people 应仅为妈妈。正文表明这是妈妈在聊天中的转述，不包装为独立医学核验。
4. 这 3 行现在的 review provider=`claude-review`，实际生成/同轮批准模型是 DeepSeek。不得继续伪装为 Claude 或以生成即批准。通过现有 correction/review repository 路径追加真实更正和审阅历史，保留旧记录，不直接 UPDATE 覆盖历史；记录真实模型和 prompt/policy 证据。若现有 schema provider 枚举有限，在 reason_codes/结果中如实记录 actual model，并解释兼容字段，不能声称 Claude 审过。
5. `organizer-month-write.mjs` 目前语义审阅仅在 `--semantic-review` 时运行。这不是长期自动解法。`--commit` 成功写出新 story 后应默认执行审阅；允许明确的维护/诊断 dry-run 不调用模型。失败或无法应用修正必须保持 agent pending/needs review，不能 approved，也不能要求 Teddy 审。
6. 出生前判断必须使用 profile birthDate，不能永久硬编码 `year < 2025`；2024 暖色和“出生前”保留。若当前页面结构只能按年份分组，至少从 archive 的 birthDay 派生出生年份；不要引入大改版。

## 最小验收

- 只核对上述 3 条当前 story、people、source_ids 和最新 review；每句话可回指原消息。
- 精确重跑同一更正一次，证明幂等且不生成重复 story/review。
- 证明月度 `--commit` 正常路径默认进入 semantic review；不另建庞大测试框架。
- 复用 d111e73 已有 typecheck/build；仅在代码变更后跑一次相关 typecheck 或最小检查，不重复全套测试。
- 更新 `C:\Users\teddy\Documents\NianlifeOps\artifacts\NIGHT-RELATIONS-20260921\R7-RESULT.md`，写真实最终状态、3 条修正前后、审阅模型/记录方式、是否可部署。

## 交付

提交并 push main，写 commit SHA。不要部署。不要以“已知瑕疵可后续人工修正”结束。

## Codex review 2026-09-22 17:36

- `r8-correct-prenatal-stories.mjs` 当前草稿调用 `computeContentSha(current.title, current.story)`，但函数签名接收完整 row；这会计算空字段版本，必须改为 `computeContentSha(current)` 或直接使用 repository 的 `getStoryContentVersion()`，后者优先，避免再复制哈希协议。
- 当前任务授权发生在本轮 2026-09-22；保留 repository 所需兼容 reason 的同时，追加本任务卡/日期，不能仅写旧的 `authorized-by:teddy-2026-09-16` 让审计误以为旧授权覆盖了这次新增内容。
- 修正后不要把 `STALE_REVIEW_CONTENT` 一律降成“content match 即幂等”；还需核对 people 与已存在的同一 request fingerprint。优先依赖 repository 自带的幂等返回。

## Teddy steering 2026-09-22 17:37

- 用户本人姓名在故事、人物字段和面向用户的报告中统一显示为 `Ted`，不要写“泰德”。把本轮三条修正中的 `泰德` 全部替换为 `Ted`；后续提示词/模板也遵循这一显示偏好。

## Codex hook verification 2026-09-22 17:40 — must fix before completion

- Production schema has `source_memory_links`, not `life_event_sources`. Current `organizer-month-write.mjs` post-write review query joins the nonexistent `life_event_sources` table, so the claimed automatic hook will fail on its first real run. Use the actual link schema/column names already used elsewhere in the repository and verify one bounded query.
- If `DEEPSEEK_API_KEY` is missing, current code only logs “skipping semantic review” after stories have been written. This silently leaves the original decision state and violates the no-manual-review requirement. Treat missing reviewer/config or review error as an explicit failed/pending agent-review outcome; do not report the batch fully complete or publishable. Do not route it to Teddy.
- Update the misleading comment `Post-write semantic review (--semantic-review)` now that review is default for `--commit`.

## Acceptance 2026-09-22 17:52

- accepted_sha: `5d803c08967df0ec9dd0db9a06cdb6ca5b2bd8b6`
- push: `origin/main` matches accepted SHA.
- production DB read-only verification: all three stories now use `Ted`; unsupported presence/emotion claims are removed; people are `["苏静","Ted"]`, `["苏静","Ted"]`, `["苏静"]`; source_ids unchanged; prior review rows retained and correction rows appended.
- hook verification: actual production table is `source_memory_links`; bounded live query returned linked sources for organizer-v2 events. Missing reviewer key now fails explicitly rather than silently skipping.
- code verification reused: R8 typecheck passed before the final script-only/hook correction; no expanded test suite per user instruction.
- release: not deployed. Prior Claude automatic approval rejected ECS deployment pending an explicit deployment instruction; Codex did not bypass it.
