# Nianlife Phase 2 数据备份执行方案（v3，独立完整版，待总指挥审核，未执行）

生成时间：2026-09-07（Cowork 执行协调）
配套文档：`docs/nianlife-P0-report-2026-09-06.md`（Phase 0 最终报告，任务卡 P1-07）
本文件同时存放于：仓库 `docs/nianlife-P2-backup-execution-2026-09-07.md` 与 `C:\Users\teddy\Downloads\nianlife-P2-backup-execution-2026-09-07.md`。
状态：**本文件是独立、完整、可逐条执行的方案（不依赖"见另附文档"），但本轮仍只是设计，未运行任何一步。未经总指挥批准，不连接、不导出生产数据库，不开始任何代码改造。**

---

## 0. 边界声明

- 本文档是执行计划，不是执行记录。本轮**没有**建立任何数据库连接，**没有**运行任何 SQL、`pg_dump`、恢复或核对命令。
- **全程不得记录连接串、密码、Token 或任何私人内容**：本文档所有命令示例中的连接串、临时环境地址均为占位符（`<...>`），执行时由 Teddy 通过环境变量临时提供，不写入命令行参数、不写入本文档、不写入任何日志文件、不提交进仓库。执行完成后立即 `unset` 相关环境变量。若任何输出（日志、报错信息、查询结果）意外携带了实际的家庭内容/私人文字/媒体片段，一律不摘抄进本文档或任何交付物，只记录"发生了什么类型的事、涉及多少条/多大"这类元信息。
- **输出目录必须在 Git 仓库之外**：所有备份文件、清单、日志一律写入仓库工作区之外的目录，例如 `~/nianlife-backups/2026-09-07/`（对应 Windows 下 `C:\Users\teddy\nianlife-backups\2026-09-07\`）。该目录不得位于 `C:\Users\teddy\Documents\Nianlife` 仓库工作区内，不得被 `git add`，不进 `.gitignore` 白名单以外的任何提交。
- 批准流程：总指挥审核本文档 → 确认范围、连接预算、失败处理方式无异议 → 明确批准 → 才允许执行第 3 节的步骤。批准前，不会以任何理由（包括"只查一行验证"）连接 Neon。
- 依据 Phase 0 报告的实测：Neon 计划保持 **Launch**（Teddy 已决定本轮不降级、不删除项目、不旋转凭据——一旦获批执行，可使用现有凭据，不需要额外的凭据轮换步骤；凭据本身仍然只在执行时临时通过环境变量使用，不写入本文档、仓库或聊天记录）；PostgreSQL **18**；本计费周期（9/6–10/1）此前截图 storage 151.13 MB、network transfer 0 kB。这个数据量级（约 150MB 级别的库）是本方案时间/连接预估的依据。

---

## 1. 目标

在不影响生产状态（Vercel 仍 Paused，Git 自动部署已断开，Neon 保持 Launch 未降级）的前提下，取得**两份相互独立、且都经过实际恢复验证**的数据库备份，为迁移提供"源端已安全保全"的证据，并把整个过程的资源消耗控制在可预估、可解释的范围内。

## 2. 前置条件（执行前必须成立）

1. 总指挥已审核并批准本方案。
2. Teddy 确认可以在执行当时通过环境变量提供一次性使用的连接方式（现有凭据，未旋转），且知晓这次操作会产生真实但预计极小的 Neon 用量。
3. 执行环境已确认没有其他 Session 正在对同一个 Neon 项目做任何操作。
4. 执行前重新确认一次 Neon 项目当前状态（计划、endpoint 状态、本周期已用量），作为本次操作的"操作前基线"，只记录状态数字，不记录凭据。
5. 已确认本地/执行环境的 `pg_dump`/`pg_restore`/`psql` 客户端版本可用（见 3.0），且已准备好仓库之外的输出目录。

## 3. 执行步骤（可逐条执行的命令模板，未执行）

以下命令中所有 `<...>` 均为占位符，执行时由 Teddy 通过环境变量临时提供，不写入本文档、不写入命令行参数、不写入日志。

### 3.0 客户端版本检查

```bash
pg_dump --version
pg_restore --version
psql --version
```

预期：主版本号为 **18.x**，与 Neon 服务端 PostgreSQL 18 一致。若客户端主版本低于 18，必须先升级客户端，不得用旧版本 `pg_dump` 对 PostgreSQL 18 服务端做全量导出（可能丢失新版本类型/特性支持，且恢复到同为 18 的隔离环境时可能不兼容）。

### 3.1 两份相互独立的 PostgreSQL 完整备份

```bash
mkdir -p ~/nianlife-backups/2026-09-07
export SOURCE_DATABASE_URL="<执行时由 Teddy 临时提供，不落盘、不写本文件>"

pg_dump -Fc --no-owner --no-privileges \
  --dbname="$SOURCE_DATABASE_URL" \
  --file=~/nianlife-backups/2026-09-07/full-backup-1.dump

pg_dump -Fc --no-owner --no-privileges \
  --dbname="$SOURCE_DATABASE_URL" \
  --file=~/nianlife-backups/2026-09-07/full-backup-2.dump
```

- 两次调用相互独立（不同进程调用、不同输出文件、不复用同一次内存/文件缓存），目的：两份独立产物互相印证，任何一份损坏都能用另一份交叉核实。

### 3.2 一份 schema-only 备份

```bash
pg_dump --schema-only --no-owner --no-privileges \
  --dbname="$SOURCE_DATABASE_URL" \
  --file=~/nianlife-backups/2026-09-07/schema-only.sql
```

用途：核对表结构完整性，供后续在阿里云 RDS 建库时参照。

### 3.3 元数据、行数与序列核对

```bash
# PostgreSQL 版本 / 时区 / collation
psql "$SOURCE_DATABASE_URL" -Atc "
select 'server_version', current_setting('server_version')
union all select 'timezone', current_setting('TimeZone')
union all select 'datcollate', datcollate from pg_database where datname = current_database();
" > ~/nianlife-backups/2026-09-07/env-metadata.txt

# 已启用扩展
psql "$SOURCE_DATABASE_URL" -Atc "
select extname, extversion from pg_extension order by 1;
" > ~/nianlife-backups/2026-09-07/extensions.txt

# 逐表精确行数（表数量不多，可用 count(*) 精确统计，而非估算）
psql "$SOURCE_DATABASE_URL" -Atc "
select table_name from information_schema.tables
where table_schema='public' and table_type='BASE TABLE' order by 1;
" | while read -r t; do
  c=$(psql "$SOURCE_DATABASE_URL" -Atc "select count(*) from \"$t\";")
  echo "$t|$c"
done > ~/nianlife-backups/2026-09-07/table-rowcounts.txt

# 序列当前值
psql "$SOURCE_DATABASE_URL" -Atc "
select sequencename, last_value from pg_sequences order by 1;
" > ~/nianlife-backups/2026-09-07/sequences.txt
```

用途：确保阿里云 RDS 建库参数与源库完全一致，避免因排序规则、时区差异导致查询结果或索引行为不一致；行数/序列清单作为迁移前后数据完整性比对的基准。

### 3.4 每个备份文件的 SHA-256

```bash
cd ~/nianlife-backups/2026-09-07
sha256sum full-backup-1.dump full-backup-2.dump schema-only.sql > checksums.sha256
```

用途：确认文件内容一致性（辅助判断两次 dump 之间源库是否发生写入），以及后续任何一次传输/存储后可重新计算校验，确认文件未损坏。

### 3.5 两次隔离恢复（均为 PostgreSQL 18，与生产完全隔离）

```bash
# 隔离环境 1：全新、非生产的 PostgreSQL 18 实例
export RESTORE_TARGET_1="<临时环境 1 的连接串，非生产，执行时提供>"
createdb --dbname="$RESTORE_TARGET_1" 2>/dev/null || true
pg_restore --no-owner --no-privileges \
  --dbname="$RESTORE_TARGET_1" \
  ~/nianlife-backups/2026-09-07/full-backup-1.dump

# 隔离环境 2：另一个独立、非生产的 PostgreSQL 18 实例
export RESTORE_TARGET_2="<临时环境 2 的连接串，非生产，执行时提供>"
createdb --dbname="$RESTORE_TARGET_2" 2>/dev/null || true
pg_restore --no-owner --no-privileges \
  --dbname="$RESTORE_TARGET_2" \
  ~/nianlife-backups/2026-09-07/full-backup-2.dump
```

- 两个恢复目标必须相互隔离（不是恢复到同一个库覆盖测试），且都不是生产/预发环境。

### 3.6 恢复后对账（逐表核对，非仅看行数）

```bash
# 对 RESTORE_TARGET_1、RESTORE_TARGET_2 分别重复 3.3 的三类查询（行数/序列/扩展），
# 与 table-rowcounts.txt / sequences.txt / extensions.txt 逐项比对
```

- **行数对账标准**：逐表行数与 `table-rowcounts.txt` 完全一致才算通过。
- **序列对账标准**：`last_value` 与 `sequences.txt` 完全一致。
- **扩展对账标准**：`extensions.txt` 列出的扩展在两个恢复库中全部存在且版本一致。
- **字段级抽样比对**：对关键表另取若干行（例如按主键抽样）与源库同 ID 记录做字段级摘要比对，不能只看行数——目的是证明"备份文件本身真的可以恢复出正确的数据"，而不是"文件存在就等于可用"。

### 3.7 收尾与凭据清理

```bash
unset SOURCE_DATABASE_URL RESTORE_TARGET_1 RESTORE_TARGET_2
```

- 执行完成后立即清除本次会话中出现过连接串的环境变量；不在任何文档、日志、聊天记录中回填实际连接串内容。

---

## 4. 预计连接数、执行时间、超时与中止条件

- **预计连接数**：3.1（两次独立完整备份，各 1 次连接）+ 3.2（1 次）+ 3.3（若干项元数据/行数/序列查询可合并在同一次连接内完成，计 1 次）。**预计对生产 Neon 项目的连接次数在 4～6 次之间**，执行前会再报一次精确值；3.5 的两次隔离恢复在独立的非生产临时环境里执行，不计入对生产 Neon 项目的连接次数。
- **涉及的 SQL 类型**：全部只读——`pg_dump`/`pg_dump --schema-only` 内部使用的 `COPY`/`SELECT`、`count(*)` 统计查询、`information_schema`/`pg_catalog` 系统目录的元数据查询（版本、扩展、时区、collation、序列）。**不执行任何 `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`DROP` 等写操作或结构变更**。
- **预计执行时间**：以已知库规模（storage 151.13 MB）估算，`pg_dump` 本身预计数分钟量级完成；行数统计和元数据查询是秒级操作。3.0–3.4 预计 10～20 分钟内完成一轮；3.5 的隔离恢复视临时环境资源而定，预计额外 10～30 分钟。**执行前会先用一次只读的 `pg_database_size()` 查询重新确认库大小，不满足预估量级时先停下重新评估，不会径直按原计划跑完。**
- **超时设置**：单次 `pg_dump`/查询操作设置合理超时（具体数值在执行前根据当时库规模确认，不预先写死一个可能不合理的数字）；超过预期数量级（例如耗时超出预估 3 倍以上，或连接数超出预估上限）即视为异常。
- **中止条件与方式**：任一步骤出现连接失败、超时、或返回结果与预期规模明显不符（行数、库大小数量级异常），**立即停止后续步骤，不重试、不自动切换到更激进的方式（放宽超时、扩大查询范围）**。中止后如实记录当时的状态和错误信息（不含凭据、不含私人内容），上报总指挥，等待下一步指示。

---

## 5. 不做的事情（明确边界）

- 不记录、不保存、不在任何文档/日志/聊天记录中出现连接串、密码、Token 或其他凭据。
- **不记录任何私人内容**：执行过程中如果查询结果、日志或错误信息里携带了实际的家庭文字/照片描述/聊天内容，一律不摘抄、不引用，只记录类型和数量级的元信息。
- 不做任何写操作，不修改、不删除生产库中的任何数据。
- 不在未获批准时建立任何数据库连接。
- 不把两份备份或其中的数据内容提交进 Git 仓库（备份文件、逐表数据清单属于家庭敏感信息，只存仓库之外的受控目录，仓库只留脱敏摘要）。
- 不因为"看起来很顺利"而擅自扩大范围（比如顺带导出媒体清单、顺带验证应用能否连接新库），本方案只覆盖第 3 节列出的范围。
- 不开始任何代码改造（媒体存储适配、Cron 替换等留待后续任务卡）。

---

## 6. 交付物与验收标准

- 交付物：两份完整备份文件及其 SHA-256、一份 schema-only 备份及其 SHA-256、一份全表行数清单、一份序列状态清单、一份扩展/PostgreSQL 版本/时区/collation 记录、两次隔离恢复的逐表对账结果——全部存放于仓库之外的受控目录（例如 `~/nianlife-backups/2026-09-07/`），不进 Git 仓库。
- 验收标准：两份完整备份的 SHA-256 一致或差异可解释（如两次备份之间源库确有正常写入）；两次隔离恢复的逐表行数、字段摘要、序列状态都与备份内容吻合；全程连接次数、耗时、SQL 类型与本方案第 4 节的预估量级相符，任何显著偏离都需要在交付时说明原因。

---

**本方案到此为止，等待总指挥审核批准。批准前不连接 Neon，不导出生产数据库，不开始任何代码改造。**
