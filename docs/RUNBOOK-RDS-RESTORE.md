# Nianlife RDS 恢复/对账 Runbook

> 版本：v4，2026-09-09，Cowork 起草 v1，Code 会话按 Teddy 反馈修正（v2）、按 RDS 控制台截图确认信息更新（v3）、按 Phase 4 执行反馈纠正过严的 locale 停止条件与目录格式备份命令（v4）
> 权威版本：本仓库 `docs/RUNBOOK-RDS-RESTORE.md`
> 适用阶段：Phase 4（目标库恢复，Teddy 已授权持续有效：只读读 Neon、写 RDS `nianlife`，不 DROP/不改 DNS/不公开流量，遇停止条件立即停）
> v4 仍是文档修改：本轮未连接 RDS（缺 RDS 数据库账号凭据与 ECS 执行机信息，见第 4 节），已完成的是 Neon 只读复核与 locale 兼容性判断，均不写入任何数据库。

---

## 已确认的 RDS 目标环境信息（2026-09-09，Teddy 控制台截图确认）

| 项目 | 值 |
|---|---|
| 实例 ID | `pgm-bp11778gex0hi870` |
| 区域 / 可用区 | 杭州 / 可用区 H |
| 内网地址 | `pgm-bp11778gex0hi870.pg.rds.aliyuncs.com` |
| 端口 | `5432` |
| PostgreSQL 版本 | `18.0` |
| 实例状态 | 运行中 |
| 目标数据库 | `nianlife`（已存在，无需重新执行 `CREATE DATABASE`，见 3.1 节） |
| 字符集 | `UTF8` |
| Collate | `C` |
| Ctype | `en_US.utf8` |
| 默认白名单组 | `172.16.0.0/12` |

**仍未确认，禁止猜测**（见第 4 节）：ECS 执行机 IP、源库最新逐表行数、Neon egress 用量、（除默认白名单组外的）安全组规则细节。源库实际 locale（`C.UTF-8`/`C.UTF-8`）已于 2026-09-09 查明，并按第 1.2 节完成最小兼容性判断（结论：与目标库 `Collate=C`/`Ctype=en_US.utf8` 技术兼容），不再是待确认项。

---

## 0. 约束与边界（执行前必读）

**必须保留的闸门（不经 Teddy 明确授权绝不触碰）**

- 生产数据库的连接和写入（Neon 源库、阿里云 RDS 目标库）
- 产生费用的资源操作（ECS、RDS、OSS 读写）
- DNS、TLS、公开流量切换
- 凭据、儿童媒体、家庭原始数据
- `DROP DATABASE` 或任何不可逆删除操作（见第 5 节，需 Teddy 单独批准，不包含在默认回滚流程内）

**全程不记录以下内容**

- 连接串、密码、Token、API Key
- 任何家庭私人内容（照片描述、聊天文字）——只记录类型和数量级

**停止条件**（任一触发立即停，不重试，上报 Teddy）

- 任何步骤出现连接失败、超时、或行数与基准偏差 > 0.1%
- pg_restore 报错，或退出码非 0（即使日志看起来"non-fatal"也先停，见第 3.3 节退出码检查）
- 目标 RDS PostgreSQL 版本低于源库 PG18，且未完成单独的兼容性验证并获得 Teddy 批准（见第 2 节；已确认目标为 18.0，此条当前不触发，但仍需保留检查步骤，不得删除）
- RDS 存储用量或网络出量出现非预期大幅增长
- 无法确认源库实际 locale/collation；或确认后按第 1.2 节的最小兼容性判断，发现某项唯一约束/排序/大小写/字符分类的实际依赖会被 locale 差异影响、且当场无法排除（locale 名称不同本身不是停止理由，见第 1.2 节 2026-09-09 纠正）

---

## 1. 已有产物（Phase 2 完成，无需重跑）

| 产物 | 位置 | 状态 |
|---|---|---|
| 完整备份 A（`-Fc`） | `C:\Users\teddy\nianlife-backups\` | ✅ 已验证可恢复 |
| 完整备份 B（`-Fc`） | `C:\Users\teddy\nianlife-backups\` | ✅ 已验证可恢复 |
| Schema-only 备份 | 同上 | ✅ |
| SHA-256 清单 | 同上 | ✅ 两份一致 |
| 逐表行数基准（源库） | 见第 2 节 | ✅ |
| 序列状态 | 同上 | ✅ |
| 两次隔离恢复对账 | 完成 | **partial / changes_requested** |

**Phase 2 状态（明确写出，不用"验收通过"四字带过）**：核心备份/恢复成功——两次独立恢复均通过行数核对；但完整一致性验收状态为 **partial / changes_requested**，序列、扩展、timezone、collation 等元数据字段尚未在恢复后逐项对账，本 Runbook 第 3.4–3.6 节的对账步骤用来补齐这些缺口，不能省略、不能只看 `n_live_tup` 就判定通过（见第 3.4 节）。

### 1.1 源库行数基准（2026-09-06 Cowork 独立查库，执行前必须重新查一次刷新）

| 表 | 行数（2026-09-06 查库快照，非执行时基准） |
|---|---|
| raw_sources | 46,742 |
| media_assets | 9,077 |
| life_events | 651 |
| monthly_snapshot | 16 |
| 其他业务表 | 待执行前一次查全，不得遗漏任何业务表 |

> 执行前必须重新查一次 Neon 源库（用 `DATABASE_URL_UNPOOLED`），更新此表为最新行数，作为第 3.4 节对账的唯一基准。上表数字是写 Runbook 时的历史快照，不能直接当执行基准用。

### 1.2 源库 locale / collation（待执行前查询，不得硬编码）

执行前必须先查询源库实际 locale/collation，不能假设为 `en_US.UTF-8`：

```sql
-- 连接源库执行
SHOW lc_collate;
SHOW lc_ctype;
SHOW server_encoding;
SHOW timezone;
```

查到结果后：

1. 与目标库已确认的固定值对比：`Collate=C`、`Ctype=en_US.utf8`、`server_encoding=UTF8`（见「已确认的 RDS 目标环境信息」表）。目标库 `nianlife` 已存在，locale 是建库时固定的，无法事后免代价更改。
2. **locale 名称不同不自动等同于不兼容**（2026-09-09 纠正：v2/v3 曾要求名称不一致就无条件停止，过严）。名称不一致时不要直接停，改做以下最小判断：
   - 检查 schema 里依赖文本排序、大小写转换、字符分类或显式 `COLLATE` 的用法：`grep` 唯一约束/索引定义（是否建在自然语言文本列上，还是 hash/UUID/复合业务键上）、`ORDER BY` 是否作用于用户可读文本列、是否用了 `ILIKE`/`LIKE`/`LOWER()`/`UPPER()`/显式 `COLLATE`。
   - libc（非 ICU）locale——包括 `C`、`C.UTF-8`、`en_US.utf8`——都是**确定性（deterministic）collation**：字节相同的字符串才判等，`=` 等值比较和唯一约束不受 locale 影响；locale 只影响 `ORDER BY`/`<`/`>` 的排序顺序和 `LIKE`/正则的字符分类。
   - 只有当业务确实依赖跨 locale 会变化的排序/大小写/字符分类（例如用户可读文本的字典序展示、`ILIKE` 模糊匹配）时，才需要在 RDS 上做有界、只读的常量表达式验证（如 `SELECT 'a' < 'B' COLLATE "en_US.utf8"` 之类），并把判断结论和依据记进本节，判断通过后直接继续，不必单独另建审计任务等待批准。
   - 2026-09-09 对本仓库当前 schema/查询的判断结论：`v2/lib/db/schema.ts` 里所有 `unique()`/`uniqueIndex()` 都建在 checksum、fingerprint、provider+external-id、jobKey、profileId+month 等 hash/ID/复合业务键上，不是自然语言文本；全仓库未发现 `ILIKE`/`LIKE '...'`/`COLLATE`/`LOWER()`/`UPPER()`；仅有的两处 `ORDER BY`（`postgres-repository.ts` 里 `chat_import_tasks`/`organizer_jobs` 的任务领取查询）排序键是 `created_at asc, id asc`，`id` 只作为并发抢占时的 tie-breaker，不影响业务数据正确性。结论：**源库 `C.UTF-8`/`C.UTF-8` 与目标库 `Collate=C`/`Ctype=en_US.utf8` 对当前 schema/查询模式技术上兼容**，可以继续，不需要重建目标库。若后续 schema 增加了依赖文本排序/大小写/字符分类的新用法，需要重新做此判断，不能援引这条历史结论。
   - 若判断发现某项唯一约束、数据正确性或实际业务行为可能受影响、且当场无法排除，仍要先停，说明具体影响后再交给 Teddy 决定，不自行重建目标库（重建属于第 5.1 节的破坏性操作，需单独批准）。

---

## 2. 前置条件（执行前必须全部成立）

- [ ] Teddy 已明确授权本次恢复操作
- [x] 阿里云 RDS 实例已创建，可连接——实例 `pgm-bp11778gex0hi870`，杭州可用区 H，运行中（2026-09-09 控制台截图确认，见上表）
- [x] 已确认 RDS PostgreSQL 版本 = `18.0` ≥ 源库 PG18，版本门禁满足，无需单独兼容性验证
- [x] 已按第 1.2 节查询源库实际 locale/collation（`C.UTF-8`/`C.UTF-8`）并完成最小兼容性判断——与目标库 `Collate=C`/`Ctype=en_US.utf8` 名称不同但对当前 schema/查询模式技术兼容（2026-09-09，见 1.2 节判断依据），不阻塞
- [ ] 已确认 RDS 存储空间 ≥ 源库逻辑数据量的 3 倍
- [ ] 备份文件 A 已传输到执行环境（ECS 或本机），SHA-256 已重新校验与 Phase 2 记录一致
- [x] 目标库已存在——`nianlife`（UTF8 / Collate C / Ctype en_US.utf8，2026-09-09 控制台截图确认），第 3.1 节改为核对而非新建
- [ ] ECS → RDS 连接方式已按第 2.1 节确认，且已验证连通（内网地址已知，执行机 IP、安全组具体规则仍待填写）
- [ ] 执行环境已安装 `pg_restore`，版本 ≥ 源库主版本（建议用 PG 官方镜像，避免版本不匹配）
- [ ] 此时没有其他会话对 Neon 或目标 RDS 做任何操作

### 2.1 ECS → RDS 连接方式（优先级）

1. **优先**：ECS 与 RDS 在同一 VPC，通过内网地址（`pgm-bp11778gex0hi870.pg.rds.aliyuncs.com:5432`）+ 安全组规则连接（不经公网）。已知默认白名单组为 `172.16.0.0/12`（2026-09-09 控制台截图确认）；具体放行哪个执行用 ECS 实例/安全组规则仍待执行时确认，不得假设默认白名单组已经覆盖实际执行机。
2. **仅在确有需要时**：RDS 公网地址 + IP 白名单。使用前确认没有内网路径可用（例如执行环境不在阿里云内），白名单只加执行机器的实际出口 IP（待填写，见第 4 节），用完后移除。

```bash
# 内网连通性验证（ECS 内执行）
psql -h pgm-bp11778gex0hi870.pg.rds.aliyuncs.com -p 5432 -U <用户> -d nianlife -c "SELECT 1"
```

---

## 3. 执行步骤

### 3.1 目标库核对（`nianlife` 已存在，不重新建库）

2026-09-09 控制台截图确认目标数据库 `nianlife` 已存在，编码 `UTF8`、`Collate=C`、`Ctype=en_US.utf8`，**不需要、也不应该重新执行 `CREATE DATABASE`**。执行恢复前改为连接核对：

```sql
-- 连接 RDS 目标库 nianlife，核对实际值与控制台截图一致
SHOW server_encoding;   -- 预期 UTF8
SHOW lc_collate;        -- 预期 C
SHOW lc_ctype;          -- 预期 en_US.utf8
```

若核对结果与预期不符，先停止，上报 Teddy，不得继续恢复。

locale 兼容性判断结论见第 1.2 节 2026-09-09 纠正：源库 `C.UTF-8`/`C.UTF-8` 与目标库 `Collate=C`/`Ctype=en_US.utf8` 名称不同但技术兼容，不阻塞本步骤。

2026-09-09 已查明：源库扩展仅 `plpgsql`（PostgreSQL 内置，任何库默认自带），没有其他扩展需要在 `nianlife` 库内提前启用，本步骤跳过。

### 3.2 校验备份文件（目录格式，不是单文件 `-Fc`）

备份 A/B 是 `pg_dump --format=directory` 产物，每份是一个目录（`full-backup-1`/`full-backup-2`），内含 `toc.dat` + 多个 `<oid>.dat.gz` 数据文件，不是单一 `backup_a.dump` 文件——不得假设文件名，按目录实际内容校验：

```bash
# 在执行机器上，对目录内全部文件重新计算 SHA-256，与 Phase 2 清单
# ops/meta-2026-09-08/sha256-manifest-2026-09-08.txt 逐项比对（61 项，含 full-backup-1/2 全部文件）
find full-backup-1 -type f -exec sha256sum {} \;

# 快速探查备份结构（不做恢复），目录格式需要 --format=directory
pg_restore --format=directory --list full-backup-1 | head -50
```

### 3.3 执行 pg_restore 到目标库

```bash
# 使用备份 A（目录 full-backup-1；B/full-backup-2 本轮只保留，不作为恢复目标）
# 不在命令行写密码，使用 PGPASSWORD 环境变量或 .pgpass

pg_restore \
  --format=directory                 \
  --host=pgm-bp11778gex0hi870.pg.rds.aliyuncs.com \
  --port=5432                        \
  --username=<RDS用户名，待填写>    \
  --dbname=nianlife                  \
  --no-owner                         \
  --no-privileges                    \
  --exit-on-error                    \
  --verbose                          \
  --jobs=1                           \
  full-backup-1 > restore.log 2>&1
RESTORE_EXIT_CODE=$?

# 不要用 `pg_restore | tee` ——管道会让 $? 拿到 tee 的退出码而不是 pg_restore 的，
# 掩盖 pg_restore 实际失败的情况。上面用重定向 + 显式取 $? 代替。

if [ $RESTORE_EXIT_CODE -ne 0 ]; then
  echo "pg_restore FAILED, exit code $RESTORE_EXIT_CODE — STOP, do not proceed to 3.4"
  exit 1
fi

echo "pg_restore exit code 0 — proceed to 3.4 row-count reconciliation"
```

**执行时监控**：每隔 2 分钟看一眼 restore.log 末尾，确认在正常推进（`COPY xxxx` 行数递增）。退出码为 0 只代表 `--exit-on-error` 没有中途中止，仍必须完成第 3.4–3.6 节的对账才能判定恢复成功，退出码本身不是验收标准。

### 3.4 恢复后逐表行数对账（精确 COUNT，不得只用 n_live_tup 作为唯一依据）

`pg_stat_user_tables.n_live_tup` 是统计估算值（依赖 VACUUM/ANALYZE 时机），**不得作为最终验收的唯一依据**，只能用来快速摸底、定位需要重点核对的表：

```sql
-- 摸底用，非验收依据
SELECT schemaname, tablename, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
```

最终验收要求：对**所有业务表**（不是抽样几张）执行精确 `COUNT(*)`，逐一与第 1.1 节执行前刷新的最新源库行数比对，差值必须为 0：

```sql
-- 对第 1.1 节列出的每一张业务表都要跑，不得只跑列出的几个例子
SELECT COUNT(*) FROM raw_sources;
SELECT COUNT(*) FROM media_assets;
SELECT COUNT(*) FROM life_events;
SELECT COUNT(*) FROM monthly_snapshot;
-- ……以及 information_schema.tables 里查到的其余每一张业务表
```

### 3.5 序列状态核对

```sql
SELECT sequencename, last_value, increment_by
FROM pg_sequences
ORDER BY sequencename;
```

与 Phase 2 序列状态记录逐一对比，若有偏差超过正常递增范围，手动调整：

```sql
SELECT setval('<序列名>', <正确值>);
```

### 3.6 扩展、版本、timezone、collation 核对

```sql
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SHOW server_version;
SHOW timezone;
SHOW lc_collate;
SHOW lc_ctype;
```

逐项与 Phase 2 产物 / 第 1.2 节源库查询结果对比：扩展列表完整、timezone 一致、collation 与源库一致。任何一项不一致都是最终验收未通过项，不得跳过或默认忽略。

### 3.7 应用层快速冒烟（连接测试，不对外开流量）

```bash
# 在 ECS 上（或本机），用只读账号测试应用能否连上目标库
DATABASE_URL="postgresql://<只读用户>:<pass>@pgm-bp11778gex0hi870.pg.rds.aliyuncs.com:5432/nianlife" \
  node -e "
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.query('SELECT COUNT(*) FROM life_events').then(r => {
      console.log('life_events count:', r.rows[0].count);
      pool.end();
    });
  "
```

预期输出的行数必须等于第 1.1 节执行前刷新的最新基准值，而不是本文写作时的历史快照数字。

---

## 4. 未确认项清单（执行时一次补齐，禁止猜测填写）

以下内容在写本 Runbook 时未从生产获取，执行时必须实际查询/填入，不得用占位符之外的猜测值替代：

| 项目 | 状态 |
|---|---|
| RDS 实例 ID | `pgm-bp11778gex0hi870` ✅ 已确认（2026-09-09 控制台截图） |
| RDS 区域 | 杭州 / 可用区 H ✅ 已确认 |
| RDS 内网地址 | `pgm-bp11778gex0hi870.pg.rds.aliyuncs.com:5432` ✅ 已确认 |
| RDS PostgreSQL 版本 | `18.0` ✅ 已确认 |
| 目标库编码/Collate/Ctype | `UTF8` / `C` / `en_US.utf8` ✅ 已确认（`nianlife` 已存在） |
| 默认白名单组 | `172.16.0.0/12` ✅ 已确认（不等同于「实际放行执行机的安全组规则」，见下） |
| 源库实际 locale/collation（见 1.2 节） | `C.UTF-8` / `C.UTF-8` ✅ 已查询（2026-09-09），兼容性判断结论见 1.2 节 |
| 源库扩展列表 | 仅 `plpgsql 1.0` ✅ 已查询（2026-09-09），无需额外启用 |
| 备份文件 A 路径（执行机） | `C:\Users\teddy\nianlife-backups\final\2026-09-08\full-backup-1`（目录格式） ✅ 已确认；**尚待确认是否已传输到实际执行 `pg_restore` 的机器（ECS 或本机），见 ECS 执行机行** |
| 备份文件 A SHA-256（Phase 2 记录） | `ops\meta-2026-09-08\sha256-manifest-2026-09-08.txt`，61 项已全部 `match=True` ✅ |
| ECS 执行机（主机/IP，用于经内网连接 RDS） | `待填写` —— 禁止猜测。已知存在密钥文件 `C:\Users\teddy\Downloads\nianlife-prod-ecs.pem`，但按隐私边界未记录其对应主机/IP，需 Teddy 提供 |
| 执行机器 IP（若走公网白名单路径，见 2.1 节） | `待填写` —— 禁止猜测 |
| 具体安全组入站规则（放行哪个执行源） | `待填写` —— 禁止猜测，默认白名单组不代表已配置好实际规则 |
| RDS 数据库账号（用户名/密码） | `待填写` —— 禁止猜测/搜索无关凭据目录，需 Teddy 通过环境变量或仓库外密钥文件提供，见下方约定 |
| 执行时重新查的源库行数（全部业务表） | 复用 2026-09-08 基线（19 表精确行数），2026-09-09 已核对一致，未发现新增数据 |
| Neon 出站流量用量（执行前后差值） | `待确认`——见第 6 节说明，不为获取此数据新增监控连接或创建 API Key |

**RDS 数据库账号凭据约定**（2026-09-09 新增，供 Teddy 放置凭据）：二选一，不要放进仓库：
- 环境变量：`RDS_PGHOST`、`RDS_PGPORT`（默认 5432）、`RDS_PGUSER`、`RDS_PGPASSWORD`、`RDS_PGDATABASE`（默认 `nianlife`）；或单一 `RDS_DATABASE_URL`（`postgresql://user:pass@host:port/db` 形式）。
- 仓库外文件：例如 `C:\Users\teddy\nianlife-rds.env`（`.gitignore` 覆盖范围之外的路径即可），内容为上述同名变量，执行时通过 `source`/环境变量加载，不读取到聊天记录或提交历史中。

**ECS 执行机约定**：若走 2.1 节「内网优先」路径，需要 Teddy 提供 ECS 的主机名或 IP（例如环境变量 `NIANLIFE_ECS_HOST`），以及该密钥文件对应的登录用户名（例如 `NIANLIFE_ECS_SSH_USER`）。执行环境未被告知这两项前，不会尝试连接任何未知主机。

---

## 5. 回滚顺序

若恢复失败或对账不通过：

1. **立即停止**：断开目标库连接，不做任何后续步骤
2. **默认回滚仅止步于此**：停止指向目标库的任何流量（若已存在测试流量），保留现场，**不删除目标库、不清空任何数据**
3. **保留现场**：`restore.log` 全量保存，不删除
4. **不动源库**：Neon 源库全程只读，本次恢复失败不影响源库
5. **上报**：把 restore.log 末尾 50 行 + 对账差异贴给 Teddy，等指示
6. **备用**：备份 B 未动，可以独立再试一次（需要 Teddy 授权）

### 5.1 目标库清空重建（破坏性操作，需 Teddy 单独批准）

`DROP DATABASE` 不是默认回滚步骤的一部分。只有在 Teddy 针对这一次具体情况单独批准之后，才能执行：

```sql
-- 仅在 Teddy 单独批准后执行，在 RDS 上（超级用户）
DROP DATABASE nianlife;
-- 然后重新走第 3.1 节建库
```

---

## 6. 完成标准（验收）

- [ ] 所有业务表行数与执行前刷新的最新源库基准完全一致（精确 COUNT，差值 = 0；`n_live_tup` 仅供摸底，不作为验收依据，见 3.4 节）
- [ ] 序列状态一致或差异可解释（见 3.5 节）
- [ ] 扩展列表完整（见 3.6 节）
- [ ] timezone 记录并核对差异是否有实际影响；collation 不要求字符串完全一致，但必须完成第 1.2 节的最小兼容性判断并记录结论（见 3.6 节）
- [ ] 应用层冒烟查询返回正确数字（见 3.7 节）
- [ ] `pg_restore` 退出码为 0（见 3.3 节，非管道遮蔽后的假象），且 `restore.log` 无非预期错误（允许仅 "no privileges could be revoked" 类 WARNING）
- [ ] Neon egress 用量：若能取得执行前后差值则记录；若无法取得，记录为"未确认"，不得为此新增监控连接或创建 API Key（见第 4 节）
- [ ] 第 4 节所有待填写项已补全（用实际查询结果，不是猜测）

---

*本 Runbook 执行前需要 Teddy 明确授权。授权前不连接任何数据库。*
