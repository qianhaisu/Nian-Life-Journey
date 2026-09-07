# Nianlife Phase 2 数据备份执行方案（v4，总指挥已批准，待执行）

生成时间：2026-09-07（Cowork 执行协调）
配套文档：`docs/nianlife-P0-report-2026-09-06.md`（Phase 0 最终报告，任务卡 P1-07）
本文件同时存放于：仓库 `docs/nianlife-P2-backup-execution-2026-09-07.md` 与 `C:\Users\teddy\Downloads\nianlife-P2-backup-execution-2026-09-07.md`。
状态：**总指挥已于 2026-09-07 审核批准备份任务。工具准备（第 7 节）已完成：PostgreSQL 18 客户端/服务端、两个本地隔离恢复库、7-Zip AES-256 均已就绪并验证。仍未连接、未导出生产数据库——阻塞在凭据交接方式和第二独立存储位置，见第 7 节。**

---

## 0. 边界声明

- 本文档是执行计划，不是执行记录。本轮**没有**建立任何数据库连接，**没有**运行任何 SQL、`pg_dump`、恢复或核对命令。
- **全程不得记录连接串、密码、Token 或任何私人内容**：本文档所有命令示例中的连接串、临时环境地址均为占位符（`<...>`），执行时由 Teddy 通过环境变量临时提供，不写入命令行参数、不写入本文档、不写入任何日志文件、不提交进仓库。执行完成后立即 `unset` 相关环境变量。若任何输出（日志、报错信息、查询结果）意外携带了实际的家庭内容/私人文字/媒体片段，一律不摘抄进本文档或任何交付物，只记录"发生了什么类型的事、涉及多少条/多大"这类元信息。
- **输出目录必须在 Git 仓库之外**：所有备份文件、清单、日志一律写入仓库工作区之外的目录，例如 `~/nianlife-backups/2026-09-07/`（对应 Windows 下 `C:\Users\teddy\nianlife-backups\2026-09-07\`）。该目录不得位于 `C:\Users\teddy\Documents\Nianlife` 仓库工作区内，不得被 `git add`，不进 `.gitignore` 白名单以外的任何提交。
- 批准状态：总指挥已确认范围、连接预算和失败处理方式，批准按本方案执行。工具准备期间仍不得连接 Neon；只有 PostgreSQL 18 客户端、本地恢复服务和仓库外输出目录全部就绪后，才开始第 3 节的生产只读步骤。
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

2026-09-07 在 Teddy 当前 Windows 环境实测：`pg_dump`、`pg_restore`、`psql`、Docker、WSL、GPG、age、7-Zip 和 OpenSSL 均未安装；C 盘可用空间约 111 GB，系统盘加密状态因当前会话没有管理员权限而无法确认。Claude Code 应先安装 PostgreSQL 18 客户端及一个仅监听本机的 PostgreSQL 18 恢复服务，并准备一个支持强加密且能交互输入口令的归档工具（例如 7-Zip AES-256），或准备等价的本地隔离环境。安装和初始化阶段不得连接 Neon，也不得把任何密码写进仓库、文档、命令行参数或聊天记录。

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

用途：为每个文件建立独立的完整性指纹，以便在复制、加密和长期保存后重新计算并确认文件没有损坏。**不得要求两个 custom-format dump 的 SHA-256 相同，也不得用二者是否相同判断源库是否发生写入**；两份备份的一致性通过各自恢复后的结构、逐表行数、序列和脱敏字段摘要来判断。

### 3.5 恢复到两个隔离数据库（均为 PostgreSQL 18，与生产完全隔离）

```bash
# 本机 PostgreSQL 18 管理连接；密码只通过当前会话环境变量或安全提示输入
export LOCAL_ADMIN_URL="<仅监听本机的 PostgreSQL 18 / postgres 管理连接>"

# 每次使用新的、名称唯一的空数据库；如名称已存在立即停止，不覆盖旧库
createdb --maintenance-db="$LOCAL_ADMIN_URL" nianlife_restore_1
export RESTORE_TARGET_1="<同一本机服务中的 nianlife_restore_1 连接>"
pg_restore --no-owner --no-privileges \
  --dbname="$RESTORE_TARGET_1" \
  ~/nianlife-backups/2026-09-07/full-backup-1.dump

# 隔离环境 2：同一台本机服务中的另一个全新空数据库
createdb --maintenance-db="$LOCAL_ADMIN_URL" nianlife_restore_2
export RESTORE_TARGET_2="<同一本机服务中的 nianlife_restore_2 连接>"
pg_restore --no-owner --no-privileges \
  --dbname="$RESTORE_TARGET_2" \
  ~/nianlife-backups/2026-09-07/full-backup-2.dump
```

- 两个恢复目标必须是两个不同的全新空数据库，不能恢复到同一个库后覆盖测试，也不能指向生产、Preview 或任何云端共享环境。`createdb` 返回“已存在”或其他错误时立即停止，不用 `|| true` 吞掉错误。

### 3.6 恢复后对账（逐表核对，非仅看行数）

```bash
# 对 RESTORE_TARGET_1、RESTORE_TARGET_2 分别重复 3.3 的三类查询（行数/序列/扩展），
# 与 table-rowcounts.txt / sequences.txt / extensions.txt 逐项比对
```

- **行数对账标准**：逐表行数与 `table-rowcounts.txt` 完全一致才算通过。
- **序列对账标准**：`last_value` 与 `sequences.txt` 完全一致。
- **扩展对账标准**：`extensions.txt` 列出的扩展在两个恢复库中全部存在且版本一致。
- **字段级抽样比对**：对关键表另取若干行（例如按主键抽样）与源库同 ID 记录做字段级摘要比对，不能只看行数——目的是证明"备份文件本身真的可以恢复出正确的数据"，而不是"文件存在就等于可用"。

### 3.7 加密与第二位置副本

1. 两个 dump 分别完成恢复与对账后，将 `full-backup-1.dump`、`full-backup-2.dump`、`schema-only.sql`、校验文件和脱敏核对清单打包成**强加密归档**；加密口令必须交互输入或使用本机安全凭据存储，不得出现在命令行、脚本、日志、仓库或聊天记录中。
2. 加密归档 A 保存在本机仓库外的受控目录；加密归档 B 复制到 Teddy 指定的第二个独立位置。第二位置可以是受控外接盘或 Teddy 自有的独立云存储，但不能与归档 A 位于同一磁盘上的另一个文件夹。
3. 分别计算两份**加密归档**的 SHA-256；复制完成后在目标位置重新计算，必须与源端一致。确认两个加密副本均可读取后，才允许清理未加密的工作文件和两个本地恢复数据库。
4. 如果执行时尚未确定第二位置，先完成备份、恢复验证和本机加密归档 A，并把任务状态记为“部分完成：等待第二位置”；不得把“同盘复制一份”记为独立备份。

### 3.8 收尾与凭据清理

```bash
unset SOURCE_DATABASE_URL LOCAL_ADMIN_URL RESTORE_TARGET_1 RESTORE_TARGET_2
```

- 执行完成后立即清除本次会话中出现过连接串的环境变量；不在任何文档、日志、聊天记录中回填实际连接串内容。只有第 3.7 节的两个加密副本及复算校验均通过后，整个备份任务才算完成。

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

- 交付物：两份完整备份文件及其 SHA-256、一份 schema-only 备份及其 SHA-256、一份全表行数清单、一份序列状态清单、一份扩展/PostgreSQL 版本/时区/collation 记录、两次隔离恢复的逐表对账结果，以及位于两个独立位置的加密归档 A/B——全部存放于仓库之外，不进 Git 仓库。
- 验收标准：每个原始备份文件都有独立 SHA-256；两次隔离恢复的逐表行数、脱敏字段摘要、序列状态都与同一冻结基线吻合；加密归档 A/B 位于两个独立位置，目标端复算 SHA-256 与源端一致；全程连接次数、耗时、SQL 类型与本方案第 4 节的预估量级相符，任何显著偏离都需要在交付时说明原因。

---

**本方案已经总指挥批准。Claude Code 先完成第 3.0 节的本地工具准备；确认工具和两个隔离恢复目标可用后，可按本方案连接 Neon 执行只读备份。**


---

## 7. 执行记录（本轮，Cowork 桥接环境）

**执行环境说明**：本轮工具准备在 Cowork 会话桥接的隔离 Linux VM（`device_bash`，Ubuntu 22.04）内完成，不是本文档 3.0 节最初描述的、由另一个 Claude Code 会话直接检测的 Teddy 本机 Windows 环境本身——两者是不同的执行位置。挂载的仓库文件夹（`Nianlife`）和 `Downloads` 文件夹在这个 VM 里可读写，其余 Windows 文件系统这个 VM 都碰不到。之所以在这个 VM 里完成工具准备，是因为当前没有其他可调度的 Claude Code 会话在跑；总指挥或 Teddy 如果希望改在 Teddy 本机原生 Windows 环境里装这些工具，需要另外指派。

**工具准备结果（未连接 Neon）**：
- 从 `apt.postgresql.org` 官方仓库下载 PostgreSQL 18.6（Ubuntu jammy 22.04 构建）的 `postgresql-18`、`postgresql-client-18`、`libpq5`、`libpq-oauth` 四个包，用 `dpkg-deb -x`（不需要 root）解包到用户目录，`pg_dump`/`pg_restore`/`psql`/`postgres`/`pg_ctl`/`initdb`/`createdb` 全部验证可运行，版本确认为 **18.6**，与 Neon 服务端 PostgreSQL 18 相符。
- 这个 VM 里没有可用的 `sudo`（容器安全限制，无法用 apt 直接安装系统级服务），改用上面"下载 deb + 解包"的方式，不影响功能。
- 已初始化并启动本机 PostgreSQL 18 服务，监听地址确认只有 `127.0.0.1:5433`（非 `0.0.0.0`），已创建两个全新空库 `nianlife_restore_1`、`nianlife_restore_2` 作为两个隔离恢复目标；管理口令本地随机生成，未记录在本文档或聊天记录中。
- 发现这个 VM 的一个限制：后台/常驻进程不会跨越两次独立的工具调用存活（同一次调用结束后，后台服务会被回收）。因此第 3.5/3.6 节的"启动本地服务 → 恢复 → 对账"必须在**同一次**命令执行内完成，不能像本机长期开着数据库那样跨步骤保持连接；已相应调整执行方式，不影响本文档第 3 节列出的步骤本身。
- 已安装 `p7zip-full`（同样用"下载 deb + 解包"方式，不需要 root），用一份无意义的占位文本做了 `7z a -mhe=on`（头部加密）+ `7z l`/`7z t` 全流程验证：加密创建、带密码正确解密列出、不带密码正确拒绝、完整性测试通过——确认满足"支持交互输入口令的强加密归档、AES-256"的要求。
- 网络观察（均未涉及 Neon）：`apt.postgresql.org`、`postgresql.org`(HTTPS) 访问正常；但此前发现这个 VM 到 `github.com` 的连接（SSH 22、HTTPS 443）在 TCP 握手"成功"后仍会超时、拿不到实际数据，说明这个 VM 的出站网络对不同域名的表现不一致。**Neon 的实际可达性未测试、未知**，因为测试需要真实连接目标，而本轮尚未获得连接串，也不会在没有连接串的情况下用猜测的方式探测。

**总指挥决定（原两个阻塞已解除）**：
1. **连接串交接**：使用一次性中转文件 `C:\Users\teddy\Downloads\nianlife-source-url.tmp`。该文件由总指挥先创建为空文件，Teddy 只在其中粘贴一行 Neon 连接串并保存，不在聊天中发送。Claude 必须在同一次执行调用的最开始将内容读入当前进程变量，确认非空后立即把文件截断为零字节，并设置退出清理，随后才允许发起网络连接；禁止回显变量、启用 shell trace 或把连接串拼进报告。执行结束后由总指挥从 Windows 侧删除该文件并确认不存在。
2. **第二独立位置**：Windows 已确认 `E:` 是与系统盘 `C:` 不同的物理磁盘，为外接 SanDisk SSD。加密归档 A 放在 `C:\Users\teddy\Downloads\` 的仓库外目录；加密归档 B 放在 `E:\NianlifeBackups\2026-09-07\`。`E:` 只接收最终加密归档和校验值，不落未加密 dump、连接串或私人明文。

当前只等待 Teddy 将连接串写入已经准备好的中转文件。收到“已放好”后，Claude 可在上述约束下直接执行第 3 节，无需再次请求方案批准。
