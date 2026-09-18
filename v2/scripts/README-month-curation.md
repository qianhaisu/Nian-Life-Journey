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
