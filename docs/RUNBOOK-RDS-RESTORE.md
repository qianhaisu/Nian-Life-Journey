# Nianlife RDS 恢复/对账 Runbook

> 版本：v2，2026-09-09，Cowork 起草 v1，Code 会话按 Teddy 反馈修正
> 权威版本：本仓库 `docs/RUNBOOK-RDS-RESTORE.md`
> 适用阶段：Phase 3（目标库恢复）—— 在 Teddy 提供连接授权并确认 RDS 可用后执行

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
- 目标 RDS PostgreSQL 版本低于源库 PG18，且未完成单独的兼容性验证并获得 Teddy 批准（见第 2 节）
- RDS 存储用量或网络出量出现非预期大幅增长
- 无法确认源库实际 locale/collation，且 RDS 目标版本不支持该 locale

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

1. 确认目标 RDS 实例创建时是否支持该 locale（阿里云 RDS PostgreSQL 部分 locale 需要在建实例时指定，无法事后更改）。
2. 若源库 locale 与计划中的 RDS locale 不一致，先停止，上报 Teddy，不得自行选择替代 locale。

---

## 2. 前置条件（执行前必须全部成立）

- [ ] Teddy 已明确授权本次恢复操作
- [ ] 阿里云 RDS 实例已创建，可连接
- [ ] 已确认 RDS PostgreSQL 版本，且满足以下之一：
  - RDS 版本 ≥ 源库 PG18（可直接继续）；或
  - RDS 版本 < 源库 PG18，且已**单独完成兼容性验证**（用 schema-only 备份在非生产环境试恢复、核对语法/扩展/数据类型兼容性）**并获得 Teddy 明确批准**——未完成验证或未获批准，默认在此停止，不得继续执行第 3 节
- [ ] 已按第 1.2 节查询源库实际 locale/collation，并确认目标 RDS 支持
- [ ] 已确认 RDS 存储空间 ≥ 源库逻辑数据量的 3 倍
- [ ] 备份文件 A 已传输到执行环境（ECS 或本机），SHA-256 已重新校验与 Phase 2 记录一致
- [ ] 目标库已创建（建库语句见第 3.1 节，locale 按第 1.2 节查到的实际值填写，不用占位符默认值）
- [ ] ECS → RDS 连接方式已按第 2.1 节确认，且已验证连通
- [ ] 执行环境已安装 `pg_restore`，版本 ≥ 源库主版本（建议用 PG 官方镜像，避免版本不匹配）
- [ ] 此时没有其他会话对 Neon 或目标 RDS 做任何操作

### 2.1 ECS → RDS 连接方式（优先级）

1. **优先**：ECS 与 RDS 在同一 VPC，通过内网地址 + 安全组规则连接（不经公网）。安全组只放行执行用的 ECS 实例，不放行整个 VPC 网段。
2. **仅在确有需要时**：RDS 公网地址 + IP 白名单。使用前确认没有内网路径可用（例如执行环境不在阿里云内），白名单只加执行机器的实际出口 IP，用完后移除。

```bash
# 内网连通性验证（ECS 内执行）
psql -h <RDS内网地址> -U <用户> -d postgres -c "SELECT 1"
```

---

## 3. 执行步骤

### 3.1 在 RDS 上建目标库

```sql
-- 连接 RDS（postgres 超级用户或有 CREATEDB 权限的用户）
-- LC_COLLATE / LC_CTYPE 必须填第 1.2 节查到的源库实际值，不得使用 en_US.UTF-8 默认值
CREATE DATABASE nianlife
  ENCODING '<源库 server_encoding，见 1.2 节>'
  LC_COLLATE '<源库 lc_collate，见 1.2 节>'
  LC_CTYPE   '<源库 lc_ctype，见 1.2 节>'
  TEMPLATE template0;

-- 如源库有扩展，需提前启用（实际列表从 Phase 2 产物读取，不得凭记忆列举）：
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

### 3.2 校验备份文件

```bash
# 在执行机器上重新计算 SHA-256，对比 Phase 2 记录
sha256sum backup_a.dump   # 应与 Phase 2 SHA-256 清单一致
sha256sum backup_b.dump   # 同上

# 快速探查备份结构（不做恢复）
pg_restore --list backup_a.dump | head -50
```

### 3.3 执行 pg_restore 到目标库

```bash
# 使用备份 A（B 作为备用）
# 不在命令行写密码，使用 PGPASSWORD 环境变量或 .pgpass

pg_restore \
  --host=<RDS内网地址，待填写>       \
  --port=5432                        \
  --username=<RDS用户名，待填写>    \
  --dbname=nianlife                  \
  --no-owner                         \
  --no-privileges                    \
  --exit-on-error                    \
  --verbose                          \
  backup_a.dump > restore.log 2>&1
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
DATABASE_URL="postgresql://<只读用户>:<pass>@<RDS内网>:5432/nianlife" \
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

| 项目 | 待填写 |
|---|---|
| RDS 实例 ID | `待填写` |
| RDS 区域 | `待填写` |
| RDS 内网地址 | `待填写` |
| RDS PostgreSQL 版本 | `待填写` |
| 源库实际 locale/collation（见 1.2 节） | `待填写` |
| 目标库 locale/collation（须与源库一致或已获批准的替代方案） | `待填写` |
| 源库扩展列表 | `待从 Phase 2 产物读取` |
| 备份文件 A 路径（执行机） | `待填写` |
| 备份文件 A SHA-256（Phase 2 记录） | `待从 Phase 2 产物读取` |
| 执行机器 IP（若走公网白名单路径，见 2.1 节） | `待填写` |
| 执行时重新查的源库行数（全部业务表） | `待执行前查询填写` |
| Neon 出站流量用量（执行前后差值） | `待确认`——见第 6 节说明，不为获取此数据新增监控连接或创建 API Key |

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
- [ ] timezone、collation 与源库一致（见 3.6 节）
- [ ] 应用层冒烟查询返回正确数字（见 3.7 节）
- [ ] `pg_restore` 退出码为 0（见 3.3 节，非管道遮蔽后的假象），且 `restore.log` 无非预期错误（允许仅 "no privileges could be revoked" 类 WARNING）
- [ ] Neon egress 用量：若能取得执行前后差值则记录；若无法取得，记录为"未确认"，不得为此新增监控连接或创建 API Key（见第 4 节）
- [ ] 第 4 节所有待填写项已补全（用实际查询结果，不是猜测）

---

*本 Runbook 执行前需要 Teddy 明确授权。授权前不连接任何数据库。*
