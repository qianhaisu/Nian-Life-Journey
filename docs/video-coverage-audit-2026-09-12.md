# 视频覆盖与播放入口只读盘点（2026-09-12）

**性质**：只读盘点，不改数据、不改代码、不部署、不重跑导入/Organizer。
**取数方式**：直连 Neon Postgres（`v2/.env.local` 里的 `DATABASE_URL`，
`ep-red-wind-audruaol-pooler…neon.tech/neondb`），用只读事务
（`set default_transaction_read_only = on; begin read only;` + savepoint 隔离单条查询失败）
执行一次性查询脚本（未提交仓库，跑完即删）。仓库代码版本：`be1298968340608a018b18169c662748bee25a49`
（本轮盘点前的 HEAD；工作区另有他人未提交改动 `v2/components/video-player.tsx`，本轮未触碰、未读取其内容用于结论）。

以下**第 1-6 项数字均为本轮重新查询确认**，不是抄旧文档；每条都标了查询语句要点。凡未能重新验证的，单独标注"沿用旧证据，本轮未验证"。

## 一、media 表视频覆盖（消息/引用数）

```sql
select type, count(*) from media group by 1;
-- photo 9235, video 121
select extract(year from taken_at)::int as yr, count(*) from media where type='video' group by 1;
-- 2025: 121；2026: 0
select to_char(taken_at,'YYYY-MM') as ym, count(*) from media where type='video' group by 1 order by 1;
```

| 年月 | video media 行数（消息/引用数） |
|---|---|
| 2025-05 | 2 |
| 2025-06 | 2 |
| 2025-07 | 25 |
| 2025-08 | 38 |
| 2025-09 | 21 |
| 2025-10 | 21 |
| 2025-11 | 12 |
| **2025 合计** | **121** |
| **2026 合计** | **0** |

`taken_at` 无 NULL（`null_taken_at=0`）；覆盖月份范围 2025-05-21 至 2025-11-13，共 7 个不同月份。
其中 29 条 `life_event_id` 非空（挂在 life_events 上）。

**与旧快照对比**：旧文档记录"121 条 video 类型行"与本轮一致；旧文档记录 2026 年份未提及具体数字，
本轮确认 **2026 年 media 表里没有任何 video 行**——这与"夸克 260 个视频未导入"是一致的（夸克视频尚未进 `media`/`media_assets`）。

## 二、消息/引用数 vs 去重资产数（不可混用）

```sql
select media_type, count(*) from media_assets group by 1;
-- photo 8957, video 120
select count(distinct ma.checksum), count(*)
from media m join media_assets ma on m.media_asset_id = ma.id
where m.type='video';
-- distinct checksum 120, media 行 121
```

- **消息/引用数（media 行）**：121 条。
- **去重资产数（media_assets，按 checksum 去重）**：120 个。
- 差 1：`media_asset_id` 为空的视频行 **0 条**（`video_media_rows_with_null_asset = 0`）；
  差额来自同一份文件被转发/引用两次——checksum `sha256:c78c701b…03d2` 同时挂在
  `wechat-media:5d42225ea232ae934e0f037c34c70986d8992d17d04ff94796e15ff7b603b45d` 与
  `wechat-media:8cd0ca316f62bb25b3a73a0f98fc8604477203a4c8ce2dbe8b1eae032f7d4932` 两条 media 行下，
  是**一次真实转发**造成的重复引用，不是资产缺失或漂移。

## 三、派生/播放状态——本轮最重要的一处更正

```sql
select ml.provider, ml.variant, ml.status, count(*)
from media_assets ma join media_locations ml on ml.media_asset_id = ma.id
where ma.media_type='video' group by 1,2,3;
-- wechat | original | ready | 120（对应 120 个去重资产，每个资产恰好 1 条 location）

select provider, variant, status, count(*)
from media_assets ma join media_locations ml on ml.media_asset_id = ma.id
where ma.media_type='video' and ml.provider in ('hot','oss')
group by 1,2,3;
-- 空结果集，0 行
```

**结论：截至本轮查询时刻（2026-09-12），库里 120 个视频资产、121 条视频消息引用，
`media_locations` 里唯一存在的组合是 `provider=wechat, variant=original, status=ready`（120 条，一资产一条）。
没有任何一个视频资产在 `media_locations` 里有 `provider IN ('hot','oss')` 的记录——也就是没有 poster、没有 preview、没有任何页面可交付的派生。**

分档结果（按任务要求三档）：

- **已有实际播放证据**：0 条（本轮未能重放，见下"页面核验"部分的阻塞）。
- **具备播放资源但未实播**：0 条——因为 `/api/media/[id]/route.ts` 的选路逻辑
  （`v2/app/api/media/[id]/route.ts` 第 20 行）明确规定：只有 `location.provider` 是 `hot` 或 `oss`
  才会被交付，`wechat`/`quark` 永远不会被这条路由选中（这是代码里写死的边界注释，
  "quark/wechat provider rows are never selected here regardless of variant"）。当前 120 个视频资产的唯一
  location 记录全部是 `provider=wechat`，因此**这条路由现在对全部 120 个视频资产都会返回
  404 "Media derivative is not ready"**，不存在"有资源等待播放"的中间态。
- **播放失败/无法交付**：120 个视频资产、121 条视频消息引用，全部如此。

**与既有文档的冲突，需要明确指出**：`docs/STATE.md`/`docs/DATA-LEDGER.md` 记录过"1 条视频
（checksum `ff481dfb…5c14`）已有 poster+preview 的 OSS 派生，已在 `/memory/2025/11` 验证播放成功"。
本轮专门对这一条资产（`media-asset:ff481dfbd832099df0c2a9ce2d0c4e57687a8cd8047dce6387565b36eb6b5c14`，
硬盘原件 943,379 字节、`video/mp4`）单独查询了它在 `media_locations` 里的**全部**记录：

```sql
select * from media_locations where media_asset_id = 'media-asset:ff481dfbd832099df0c2a9ce2d0c4e57687a8cd8047dce6387565b36eb6b5c14';
```

结果只有 **一条**记录：`provider=wechat, variant=original, status=ready`（`created_at`/`updated_at` 均为
`2026-09-03T07:18:02.699Z`）。**没有 poster、没有 preview、没有任何 hot/oss 记录。** 换句话说，
按当前库内数据和当前路由代码，这个曾经验证过能播的视频，**此刻应当播不出来**（`/api/media` 会 404）。

三种可能，本轮未继续深挖（超出只读盘点范围，需要下一步排查）：
1. 当时验证时用的是临时/手工派生（未经 `media_locations` 记录），验证完之后没有落库，这次查询到的就是真实的"从未持久化"状态；
2. 之前落库过 hot/oss 记录，之后被别的操作删除或回滚，未在本轮读到的文档里记录这次回滚；
3. 我的查询遗漏了某种非 `media_locations` 的交付路径——但已经对照 `/api/media/[id]/route.ts` 源码确认代码只认 `media_locations` 里 `hot`/`oss` 的记录，没有发现旁路。

**不臆测是哪一种**，只报告"现在查到的状态"：**当前数据库快照下，0 个视频资产具备可被
`/api/media` 交付的派生**，与旧文档的"1 条已播放验证"矛盾，需要 Teddy 或下一位执行者确认这条记录是否曾经存在、何时消失。

## 四、09-03 三条视频消息身份漂移——现状复核

未获得这 3 条消息的具体 `canonical id` / checksum（`docs/STATUS.md` 与 `docs/DATA-LEDGER.md` 中的记录
都只描述了决策和理由，没有列出这 3 条的具体标识符），因此**本轮无法用 checksum 或原始文件路径独立重新核对**这 3 条本身。

能确认的是：`docs/STATUS.md` 中 2026-09-12 当天（今天）的记录仍写着——

> "09-03 那三条视频消息被排除在窗口外：库里已有行，但当前导出算出的 canonical id 不同
> （媒体引用变了），纳入就会给同一条真实消息插第二行；不动、不删。"

以及同一天靠后的记录把它列入"五项剩余事项本轮不扩查"清单。**这是当天最新记录，不是过期快照**，
所以现状结论是：**决定未变——不导入、不删除，问题本身未解决，仍待专门核对**。本轮未独立验证具体 3 条的库内行是否存在，只确认了"决策现状未变"这一事实。

## 五、夸克 259 个未导入视频——现状复核

```sql
select ma.id, ma.checksum, rs.provider, rs.source_type
from media_assets ma left join raw_sources rs on ma.raw_source_id = rs.id
where ma.media_type='video' and (rs.provider='quark' or rs.source_type ilike '%quark%');
-- 0 行

select provider, source_type, count(*) from raw_sources group by 1,2;
-- wechat/wechat 44953；null/family_photo 1789（无 quark）
```

- `media_assets` 里没有任何 `media_type='video'` 且来源标记为 quark 的资产（0 行）。
- `raw_sources` 表里目前**没有任何 `provider='quark'` 的行**（无论照片还是视频）——说明夸克素材当前的导入路径（`v2/scripts/quark-photo-init.mjs`）不经过 `raw_sources` 记录 provider 字段，或者夸克照片本身走了另一套未在本轮找到的记录方式。
- 本轮检索了 `information_schema.tables` 里所有含 `quark`/`crosswalk`/`import` 字样的表，只发现 `chat_import_tasks`（微信导入任务表，与夸克无关），**没有找到独立的 Quark manifest/crosswalk 数据库表**。
- 结论：**DB 内查询确认"0 个夸克视频已入库"这一点与旧文档一致（259 未导入的数字本身来自外部 manifest 对照，不是数据库表，本轮未重新读取该 manifest 文件，沿用旧证据）**；没有发现任何新的 crosswalk 条目或视频被意外导入的迹象。

## 六、E:\WechatHis 磁盘 mp4 数量 vs 库内 video media 行数——仍未对齐

```
find E:\WechatHis -iname "*.mp4" | wc -l   →  671
```

（其中 671 个文件全部落在 `E:\WechatHis\texts\` 子目录下，`E:\WechatHis\media\` 下没有 `.mp4` 文件——目录命名和实际内容对不上，值得注意但本轮未展开。）

库内：121 条 video media 行 / 120 个去重视频资产。**671 对 120/121 之间没有做文件名/内容哈希级别的逐一映射，仍未对齐，未确认**——不能相减、不能推断"550 个视频完全没进库"，因为不知道这 671 个文件里有多少是同一视频的不同副本、缩略、导出重复文件，也不知道其时间范围是否与库内 5 个月内 7 个月的窗口重合。**这是遗留的未完成对账，本轮按任务要求明确标注而非臆造映射。**

## 七、页面核验——阻塞，未完成

**结论：本轮页面核验未能执行，属于前提不成立，如实报告，不降低标准凑数字。**

1. **私有站（loopback + SSH 隧道）**：`docs/STATE.md` 记录当前私有站入口是 `127.0.0.1:18080`
   （远端 ECS 容器经隧道转发，隧道由其他 session 维护）。本轮检测到该端口确有本机监听
   （`Get-NetTCPConnection` 命中 `18080`），但对 `/`、`/api/health`、`/memory`、`/memory/2025/11`
   全部请求均返回 **502**——隧道进程存在，但后端（远端容器）当前不可达或未响应。
2. **回退方案（本地 `npm run dev`）**：按任务指示尝试本地起 `cd v2 && npm run dev`。进程正常启动
   （`Ready in 9.7s`），但访问 `/` 返回 **500**，日志显示
   `Cannot find module '.next\server\middleware-manifest.json'`、
   `ENOENT .next\routes-manifest.json` 等一系列 `.next` 产物缺失/不一致错误——**`.next` 目录当前处于被并发写入/不一致状态**，与 `CLAUDE.md`"同一时间只能有一个 Session 对仓库做写操作"的规则吻合：很可能有另一个 session 正在构建或运行同一目录下的 Next 服务。**为避免与另一个 session 的写操作冲突**，本轮已立即停止该本地 dev 进程（`Stop-Process`），未继续排查、未删除/重建 `.next`、未重试。
3. 因此：**浏览器/curl 层面的播放核验（含"手机尺寸模拟""实际点击播放"）本轮完全未执行**，
   没有截图、没有 gif、没有 `<video>` 标签存在性检查的实测结果。
4. **重申边界**：第三点第 6 项要求的"手机尺寸检查非真机验证"声明在此依然适用——但本轮连桌面尺寸都未能核验，因此本节没有任何可报告的正面结果，只有阻塞记录。

## 结论汇总表

| 维度 | 来源 | 快照时间 | 覆盖月份 | 消息/引用数 | 去重资产数 |
|---|---|---|---|---|---|
| 2025 视频 | Neon `media`/`media_assets`（本轮重新查询） | 2026-09-12 | 2025-05 ~ 2025-11（7 个月） | 121 | 120 |
| 2026 视频（微信来源） | 同上 | 2026-09-12 | 无 | 0 | 0 |
| 2026 视频（夸克来源） | 沿用旧证据，本轮未重新读取 manifest 文件；DB 侧确认 0 已入库 | manifest 记录时间未知，DB 查询 2026-09-12 | — | 0（已入库）/ 260（manifest 记录，未验证） | 0（已入库） |

**播放状态**：本轮重新查询确认，**0 个视频资产**当前在 `media_locations` 里有 `hot`/`oss` 派生记录，
包括旧文档记录为"已验证播放成功"的那一条——这条与旧证据直接冲突，是本轮最重要的发现，需要人工确认原因。

## 未确认项清单

1. 曾经记录"已验证播放成功"的视频（checksum `ff481dfb…5c14`）为何现在 `media_locations` 里没有 poster/preview/oss 记录——本轮只能确认"现在没有"，不确定是"从未持久化"还是"曾经有过又被移除"。
2. 09-03 三条视频消息身份漂移的具体 canonical id/checksum——本轮未获得标识符，无法独立复核库内行是否存在，只确认了"决策现状（不导、不删）截至今天未变"。
3. 夸克 259 个未导入视频的数字来自外部 manifest 文件，本轮未重新读取该文件核实（DB 侧确认 0 已入库，与"未导入"结论不矛盾，但"259"这个具体数字本轮未重新验证）。
4. `E:\WechatHis` 671 个 mp4 与库内 120/121 视频行之间的映射关系——仍未对齐，未确认，本轮未展开。
5. `E:\WechatHis\texts` 目录下出现 mp4 文件而 `media` 目录下没有——目录命名与内容不符，未展开原因。
6. 页面播放核验全部未执行（私有站隧道 502、本地 dev 因 `.next` 并发冲突而主动中止）。

## 最小下一步建议（不代产品做决定，只列选项）

- **播放状态回归**：需要先搞清楚"已验证播放成功"记录消失的原因（选项：重新手工生成一次 poster+preview 并落库到 `media_locations`；或找回上一次生成时的操作记录核实是否被回滚），再决定要不要批量补 120 个视频的派生。
- **页面核验**：需要先确认远端私有容器是否仍在运行（选项：找到维护 18080 隧道的 session 确认容器状态；或在容器所在的 ECS 上直接检查），或等待没有其他 session 占用 `.next` 目录时再本地起 `npm run dev`。两条路径选一条即可满足"打开看"的验收要求，本轮都未打通。
- **09-03 三条视频身份漂移**：需要 Teddy 或知道具体 message id 的人提供标识符，才能做进一步的库内核对；目前只能维持"不导、不删"的现状。
