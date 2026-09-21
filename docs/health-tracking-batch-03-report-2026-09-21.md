# HEALTH-03 实施回执（爸妈手记 / 就医 / 已记录）

状态：**HEALTH-03 已提交审核**。本地可运行、合成数据验证通过；**不是线上可用**：未部署、未配置生产环境变量、生产启用保持关闭。基线 main `bf2a1d7`；本提交 SHA 以 `git log` 为准（回执无法写入自身 SHA）。不重开 HEALTH-01/02，不装 PostgreSQL，不接 RDS 或现有业务库，不调用模型，不进入 HEALTH-04。

## 入口与文件

- 页面：`/health/record`（`v2/app/health/record/`：`page.tsx` 服务端检查会话、`record-app.tsx` 三个入口、`record.css`）。未配置时页面只显示“这个功能还没有启用”；未登录只显示登录。视觉沿用已批准的 r2 原型。
- 接口：`/api/health-record/[...path]`（`v2/app/api/health-record/`，与既有 `/api/health` 状态检查无关）。
- 服务端：`v2/lib/health/record/`：`config.ts`（配置，缺失即关闭）、`auth.ts`（健康会话）、`media.ts`（原图）、`service.ts`（业务）、`http.ts`（分发、CSRF、缓存头）。复用 HEALTH-02 `HealthFileStore`、`planImport/applyPlan`、`applyCorrection`，没有用应用 `getStore()`、没有 localStorage 底账、没有调用 `persistCareEpisode`。
- 验证：`v2/test/health-record.test.mjs`（5 组，进 `npm test`）、`v2/scripts/health-record-e2e.mjs`（第 6 组，真实浏览器，不进 `npm test`）。

## 怎么合成运行

私有数据目录在仓库外（配置检查会拒绝仓库内路径）。四个必填环境变量：`HEALTH_RECORD_ROOT`（绝对路径）、`HEALTH_RECORD_SESSION_SECRET`（≥32 字符）、`HEALTH_RECORD_MOM_PASSWORD`、`HEALTH_RECORD_DAD_PASSWORD`（各 ≥8，且不同）；`v2/.env.example` 只有占位符。本机 HTTP 验证再设 `HEALTH_RECORD_COOKIE_SECURE=0`（生产默认 Secure）。`NEXT_DIST_DIR=.next-hr3 npx next build` 后运行 `node scripts/health-record-e2e.mjs`（自带 loopback 服务、私有目录 `NianlifeOps/health-tracking/2026-09-21/health-03-implementation/`、合成图片）。

## 关键实现选择

- **访问控制**：仓库里没有可复用的登录机制，所以做了独立健康会话：妈妈/爸爸各自服务端环境里的凭据，验证后签发 8 小时、HttpOnly、SameSite=Strict（生产 Secure）的签名 Cookie。页面数据、所有 API、原图读取都检查会话；写操作还要求 Origin 与请求主机一致（或在白名单），带 `sec-fetch-site: cross-site` 的写入被拒；所有响应 `Cache-Control: no-store, private`。作者取自会话，请求里自报的作者被忽略。同一位家长连续 5 次密码错误锁 5 分钟（进程内存）。
- **数据形态**：手记/就医各是一条 `observation`（`factKind: parent_note | visit_material`，`reviewStatus: unreviewed`），不生成确诊、服药、实际就诊事实；报告图是 `source`（`hr-img-<sha256>`），用 `from_source` 关联。症状存 `symptoms{temperature{value,unit:"℃"}, nose, cough, nasalVoice, sleep[]}`，**未选不写入**。发生时间四种语义 + 未知，默认不选=未知；“刚刚”取点击那一刻并随请求冻结；服务端校验（未来、过久、非法日期、精度）。
- **体温**：固定 ℃，35–41.5 之外先返回“请核对”，用户明确确认后保留原数值并标 `temperatureFlag: unusual_confirmed`；非数字或 ≤0、>100 拒绝。不强改、不强清空。
- **防重与并发**：新建用提交 ID（`entryId`）幂等：同请求返回已存记录，同 ID 不同内容 409；“再记一条”用新 ID。更正/撤销/恢复用请求 ID + 每实体修订号（=1+已应用的更正请求数），修订号在持锁事务内比较；冲突返回 409、当前值，页面并排显示“当前值 / 你的草稿（未提交）”，用户明确点选后才以新修订号追加更正，草稿始终不清。请求 ID 的幂等记录写在账本运行日志（不影响 `businessDigest`）。
- **原图**：真实字节保存到 `<root>/originals/<sha256>.<ext>`（内容寻址，重试写同一文件；临时文件 + rename），缩略图（≤480px、按 EXIF 方向转正）在 `thumbs/`，只用于预览。类型和大小按真实内容判定（sharp 解码），仅 JPG/PNG/WebP/GIF，单张 ≤12 MB、≤8 张、合计 ≤40 MB；SVG、改名文本、被截断图片、空文件均拒绝并给可理解的提示。读取只服务已被提交记录引用的哈希，路径只由校验过的哈希拼出。原图先写、账本后提交；账本失败时不留下被引用的图片，重试成功。
- **读取**：列表按记录时间分页（游标），详情单条；投影缓存以 `ledger.json` 的 mtime/size 为键。

## 六组结果

| 组 | 覆盖 | 结果 |
|---|---|---|
| 1 | 未认证页面数据/API/原件被拒；作者不可伪造；跨来源/缺 Origin/篡改/过期/伪造会话被拒；密码互不通用；暴力尝试受限；配置缺失或路径不安全即关闭 | 通过 |
| 2 | 手记可选项含睡眠多选/取消、未知时间、℃ 与可疑体温确认；失败后重试不重复且“刚刚”时间不漂移（过 30 分钟重试） | 通过 |
| 3 | 就医其他文本、多图上传、授权读取（逐字节一致）、EXIF 方向、备注、未知日期；坏文件/超大/过多/存原图失败/账本失败都不产生虚假成功，未提交图片不可读 | 通过 |
| 4 | 更正留前值；两个并发更正只有一个成功、败者得当前值、无静默覆盖；明确选择后追加更正双方留痕；同请求重放不增殖；同 ID 不同内容拒绝 | 通过 |
| 5 | 撤销/恢复留历史；旧记录及旧字段（剂量对象、测量方式、状态）可读且不可在此更正，字节级不被改写 | 通过 |
| 6 | 手机 390×844 真实浏览器：登录 → 手记 → 就医（上传/移除/备注）→ 查看/原图/更正/冲突/撤销/恢复；桌面 1280×860 溢出与宽度 | 24/24 通过 |

截图 4 张关键 + 若干（私有，不入 Git）：`health-03-implementation\screens\`（手记展开、就医填写、原图详情、冲突页等）。

## 检查

`npm run typecheck`、`npm run lint` 无问题；未连库生产 build（`NEXT_DIST_DIR=.next-hr3`）成功，`/health/record` 与 `/api/health-record/[...path]` 为动态路由；健康测试 5 组 + 既有 58 项通过；全仓 `npm test` 一次：1570 项，1559 通过、0 失败、11 跳过（与交付前一致的既有跳过）。`.next-hr3` 构建时被自动改动的 `next-env.d.ts`、`tsconfig.json` 已还原，未提交。

## 未验证 / 限制

- 真实手机、读屏软件、深色模式；HEIC（相册原图需先转 JPG，页面已提示）；大量大图的内存与耗时。
- 单进程文件账本：多进程/多实例同时写、Windows 之外的锁行为、进程被杀的恢复沿用 HEALTH-02 结论，本批未再测；真实 Postgres/RDS 的事务与修订号比较仍是接入前事项。
- HTTPS 下 Secure Cookie 和反向代理头（`x-forwarded-host`）只按代码逻辑处理，未在真实代理后验证；登录刹车在进程内存中，重启即清零。
- 保存后的记录不能再增删报告图（可更正文字、医院、科室、备注、时间、归属）；旧记录只能查看；分页游标按记录时间，未做全文搜索。
- 未提交草稿只在页面内存里，刷新即丢（按卡要求未做离线同步）。

## 上线前配置边界

生产启用需要 Teddy 另行决定：设置上面四个环境变量（值只放服务端环境）、确认私有数据根目录位置与备份、确认反向代理转发 `Origin/Host`、HTTPS 下 Secure Cookie、多实例部署前先解决单进程文件锁的限制。本批不部署，也不声称文件账本已获上线许可。
