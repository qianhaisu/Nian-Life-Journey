# 按月精选管线（month-*.mjs）

一个月的照片从「数据库里有多少行」走到「一份可供页面读取的精选清单」，中间六步。
九月是第一个跑通的月份；推广到历史月份**复用这套脚本**，只换 `--month`，不逐月重新开发。

全部只读：不写生产表、不改审核决定、不改可见性、不删文件。产出是本机 JSON。

## 分工（CLAUDE.md 2026-09-17）

| 工作 | 归属 | 对应脚本 |
|---|---|---|
| 精确重复、尺寸、候选分组、缓存匹配、一致性检查 | 本地程序 | `month-local-grouping.mjs`、`month-curation-check.mjs` |
| 截图识别、画面描述、组内/跨组比较、构图建议 | DeepSeek v4.1 Flash | `month-vision-analyze.mjs`、`month-crossgroup-compare.mjs`、`month-cover-candidates.mjs` |
| 调用编排、阅读层取舍、来源核对、抽检、交付检查 | Claude Code | `month-curate.mjs` + 人工抽检 |

模型固定 `deepseek-flash`。`AI_MODEL` 指向别的模型时脚本在发请求前就停；
返回模型与请求不符按硬失败处理。

## 六步

```sh
cd v2
OPS=path/to/<month>-curation

# 1. 台账：候选、四种状态、审核决定、既有解析来源
node scripts/month-curation-ledger.mjs --month=2026-09 --out=$OPS/ledger.json

# 2. 取真实字节（web 派生，可续跑，已有文件跳过）
node scripts/month-media-prefetch.mjs --ledger=$OPS/ledger.json --cache=$OPS/media-cache

# 3. 本地层：精确重复 → 去重 → 时间邻近开组 → 质量指标
node scripts/month-local-grouping.mjs --ledger=$OPS/ledger.json --cache=$OPS/media-cache \
  --out=$OPS/local-groups.json

# 4. 视觉：分类+描述（全部），组内比较（仅多图组）。缓存按字节 sha 命中
node scripts/month-vision-analyze.mjs --groups=$OPS/local-groups.json --cache=$OPS/media-cache \
  --vision-cache=$OPS/vision-cache.json --out=$OPS/vision.json --concurrency=6

# 5. 跨组：按日比较各组代表是否仍高度同质
node scripts/month-crossgroup-compare.mjs --groups=$OPS/local-groups.json --vision=$OPS/vision.json \
  --cache=$OPS/media-cache --out=$OPS/crossgroup.json

# 6. 精选 + 验收（验收失败即非零退出）
node scripts/month-curate.mjs --ledger=$OPS/ledger.json --groups=$OPS/local-groups.json \
  --vision=$OPS/vision.json --crossgroup=$OPS/crossgroup.json --cache=$OPS/media-cache \
  --out=$OPS/curation.json
node scripts/month-curation-check.mjs --ledger=$OPS/ledger.json --groups=$OPS/local-groups.json \
  --vision=$OPS/vision.json --curation=$OPS/curation.json --crossgroup=$OPS/crossgroup.json \
  --cache=$OPS/media-cache --out=$OPS/check.json

# 可选：封面候选与构图焦点（只出候选，裁切要在真实页面上验）
node scripts/month-cover-candidates.mjs --curation=$OPS/curation.json --vision=$OPS/vision.json \
  --groups=$OPS/local-groups.json --cache=$OPS/media-cache --out=$OPS/covers.json
```

## 几条踩过坑才定下来的规则

- **`media.taken_at` 按面值读**。它是 `timestamp without time zone`，存的就是上海墙钟。
  对它做 ±8 小时换算，正是让 6,738 行早八小时的那个错误。
- **先去重、再分组**。九月 651 行里有 388 行与另一行原件字节相同（同一张照片被两份微信导出各导入一次）。
  先分组会把"导入两次"当成连拍，还会把同一张图重复送给模型。
- **dHash 不作分组门**。实测同一连拍内相邻帧距离常在 17–41 位；严到能表示"同一场景"的阈值会拆散真实连拍。
  分组只用时间邻近，dHash 记录下来供查。
- **时间邻近 ≠ 连拍**。微信批量发送的照片 `taken_at` 是消息时间，同一秒里可能是完全不同的场景。
  把它们分开的是模型的比较，不是时钟。
- **`media_topic` 不是主体核验**。前者是话题分，后者是 `media_subject_check`。
  高分、高画质、来自某个群，都不能让一张照片自动进入展示清单。
- **分类覆盖数与组内比较覆盖数分开统计**。单张组没有可比对象，永远不计入"已比较"。
- **已有分类不被覆盖**。多图组为了比较必须整组重发，但重发不是把旧轮结果改标成本轮的理由。
- **截断即失败**。`stop_reason: max_tokens` 的调用不产出任何结果，并记入失败。
- **有候选但全被排除的日期必须留在结果里**，写明原因——「那天没有能看的照片」和「那天不存在」是两件事。

## 历史月份（MEMORY-08）用到的开关

第一次把管线推到九月之前的全部历史月份，暴露出几件九月规模上看不见的事，对应加了开关。
不带这些开关时行为与九月一致；唯一的默认变化是识图脚本会在同一进程里补跑截断的片段（`--retries=0` 可关闭）。

```sh
# 准入先于识图：只取、只分组、只送模型「页面可能展示」的候选
node scripts/month-media-prefetch.mjs --ledger=$OPS/ledger.json --cache=$OPS/media-cache --admitted-only
node scripts/month-local-grouping.mjs --ledger=... --cache=... --out=... --admitted-only
# 新结果的 source 写明是哪一轮；截断的片段在同一进程、同样并发下补跑（默认两轮）
node scripts/month-vision-analyze.mjs ... --concurrency=6 --run-label="MEMORY-08 2026-01" [--retries=2]
# 跨组比较只补跑上一次失败的片段，原失败记录保留并标 resolvedByRetry
node scripts/month-crossgroup-compare.mjs ... --retry-failed=$OPS/crossgroup.first-pass.json
# 封面：只从主体审核 approved 的精选里挑；--ids 让编辑把能讲这个月的照片交给模型判断焦点
node scripts/month-cover-candidates.mjs ... --ledger=$OPS/ledger.json [--ids=<id,id>]
# 独立审计：再查页面实际读取的内容文件（含封面）与字节级孪生行
node scripts/month-display-subject-audit.mjs --curation=... --month=... --content=<YYYY-MM.json> [--allow-empty]
```

- **准入先于识图**（`month-admission.mjs`）。老月份大部分照片来自不在信任名单、也从未做过主体核验的会话；
  先识图再过门，会让模型描述几千张页面永远不会展示的照片。更要紧的是正确性：连拍整组比较时，
  一张不能展示的帧可能被选成组长，其余能展示的帧就被判为「与组长重复」而全部落选。先过门，模型只在能展示的照片里选。
  没过门的候选照样有去向（`excluded:*` / `pending:subject-unverified`），只是不送模型、不需要取字节。
- **store_only 按字节否决**。同一张照片常以两个 media id 入库。一行被审阅者判为 store_only，
  同一份字节的其他行只有**自己持有 approved** 才能上页面；未审阅的孪生行不能把撤回的字节带回来。
  检查脚本与独立审计分别从台账 checksum 和数据库 checksum 复核这一条。
- **截断会发生**。历史月份里，约 1–2% 的调用写满 8000 token 被截断。截断的调用照旧记为失败、不产出结果；
  补跑用单独的标签（`#retryN`），所以截断调用的标签永远不会出现在结果里。
