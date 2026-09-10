# Nianlife 当前状态（持续维护，读这一份就够）

## 当前摘要（2026-09-10，私有诊断站验收复核轮次；下方历史全部保留）

**协作形态**：Codex 总指挥/review，用户手动把单条任务交给单个 Code 执行。当前在**第 1 步**。

### 已批准的执行顺序（用户 2026-09-10 确认，按此推进，不跳步）

1. **私有站端到端验收**：更新当前总摘要，完成明确 commit SHA 的 ECS + RDS + OSS 私有站点端到端
   验收。备案前仅 loopback + SSH 隧道。← **现在这一步。`7ac9f67` 的容器验收已通过（运行版本、
   冷启动首次响应、08-19 选图、桌面与移动端、缓存作用范围五项）；视频仍标为未交付，
   另有一个新发现的 revalidate 缺口待修，见下方「阻塞」。**
2. **收敛数据账本**：接收已有的微信强匹配、乳儿班 60/70、夸克全库集合的只读结果，区分
   确定缺失 / 已存在 / 重复候选 / 无法确认。不凭标签或简单减法判断，不无限扩张排查。
3. **幂等小批**：从确定缺失项里选最多 6 个做幂等小批，Organizer 关闭；新增准确、重复执行零新增
   之后，再确定批量范围。**现有 222 条清单未获全量执行许可。**
4. **准备公开切换**：明确唯一写入端、Neon→RDS 备份之后的增量或冻结方案、发布 SHA，以及不覆盖
   RDS 新写入的回滚方案。备案与公开入口条件满足、用户最终批准后**人工**切换。无需等全部历史补齐，
   但必须保证现有内容可读且不丢新增。
5. **恢复产品建设**：有界恢复 Organizer，推进月章节、2025 全年阅读和年度书；验收目标是苏静能
   从头翻完 2025 年。自动化和回忆浮现不插队。

原始媒体长期归档是后续必做项，但**不把全部原始媒体迁完当作当前网站验收的前置**。

**验收对象**：阿里云 ECS 上的私有诊断站 `nianlife-diag-web`，接 RDS + OSS，只经
loopback + SSH 隧道访问（备案前不开公网入口）。**正式站点 nianlife.cn / Vercel 本轮未发布、
未部署**——单独记录，不作为失败，也不触发部署。

### 一、本轮亲自验证（证据在本轮会话里重新取过，不是转述）

- **实际运行版本**：容器 `nianlife-diag-web` 跑镜像 `nianlife-web:8b8b58290df090d5b0fcf6cbb86b10f2aed64d31`
  （image id `1dec65996892`，2026-09-10 09:44 CST 构建，healthy）。构建日志
  `/tmp/nianlife-diag/build-8b8b582.log` 记录同一 image id 与 tag，构建上下文是
  `/tmp/nianlife-diag/buildctx-8b8b582`。该上下文里 `lib/media/hero.ts`、`lib/media/presentation.ts`、
  `lib/db/config.ts`、两个 `app/memory/[year]...page.tsx`、三个测试文件，**去掉 CRLF 后 sha256
  与 `8b8b582` 的 git blob 逐个相等**，所以 `d3efa81` + `c57e475` + `8b8b582` 三处改动确实在运行版本里。
  另：`c57e475`、`d3efa81` 经 `git merge-base --is-ancestor` 确认都是 `8b8b582` 的祖先。
- **连接与配置**（只记非敏感标识）：`DATABASE_URL` 指向
  `pgm-bp11778gex0hi870.pg.rds.aliyuncs.com:5432/nianlife`（阿里云 RDS，实测 `PostgreSQL 18.4`）；
  `REPOSITORY_BACKEND=postgres`；`MEDIA_STORAGE_PROVIDER=oss`，bucket `nianlife-media-teddy-202609`，
  内网 endpoint `oss-cn-hangzhou-internal.aliyuncs.com`；Organizer 关闭
  （`ORGANIZER_WORKER_ENABLED=false`、`AI_ORGANIZER_ENABLED=false`、`MEMORY_ORGANIZER=rule`）。
- **归档月页构建期修复确实生效**：镜像里 `.next` **没有任何预渲染的月页/事件页 HTML**，
  `prerender-manifest` 里 `/memory/[year]`、`/memory/[year]/[month]` 只作为 dynamicRoutes 存在；
  构建日志中没有出现过 `REPOSITORY_BACKEND` 或 build-arg。容器里那些 `memory/2026/*.html`
  是**运行期 ISR 产物**（mtime 全在容器启动之后），不是构建产物。
- **OSS 读取是真的走到了 OSS**：取月页上真实渲染的两张图，四个派生
  （web/thumbnail × 2）经真实 `/api/media` 隧道取回的字节 **sha256 与直接从 OSS bucket 读回
  同一 object 的字节 sha256 逐个相等**，大小也与 `media_locations.file_size` 相等；同时容器内
  `/app/.data` 根本不存在，本地盘不可能是来源。这一条不是靠配置或 HTTP 200 推断的。
- **旧存储不再承担页面读取**：`media_locations` 里 `hot` 的 `web`/`thumbnail` 各 8,964 条，
  `oss` 的 `web`/`thumbnail` 各 8,964 条（合计 17,928，与迁移声明一致），
  **没有任何一条 hot 派生缺少同 providerRef 的 oss 对应行**。剩下只在 hot 的是 `original`
  （archived 1,789 + awaiting_archive 7,175），而 `/api/media` 按设计从不交付 original。

### 一之一、私有诊断容器已换到 7ac9f67，冷启动验收通过（2026-09-10 第三轮）

**授权范围**：只更新私有诊断容器，不涉及正式站点或公开入口。换容器前已问过同机的另一个
session（`nianlife-70`）确认没在用它；它同时说明 **18080 隧道不是它起的**（本轮也没动那个进程，
真正的起始者未确认，需要时问 Teddy）。RDS 数据未动，Organizer 仍关闭，仍只走 loopback + SSH 隧道。

- **运行版本**：容器 `nianlife-diag-web` 现在跑
  `nianlife-web:7ac9f67c5033ac2ea995fcb01c553412fd84ccda`，image id **`d42e012a8a25`**
  （`docker inspect` 读出的运行 image digest `sha256:d42e012a8a25a4…5c0aa35`）。
  构建上下文由 `git archive 7ac9f67` 产出并上传，tar 的 sha256 两端一致；上下文里 10 个本轮改过
  的文件（含三个测试）**去掉 CRLF 后 sha256 与该 commit 的 git blob 逐个相等**。
  RDS / OSS 配置沿用同一个 `--env-file`，键集合与旧容器完全一致，未重复做来源核查，未输出凭据。
- **回滚信息已留**：旧镜像 `nianlife-web:8b8b58290df090d5b0fcf6cbb86b10f2aed64d31`
  （image `sha256:1dec659968…`）、`c57e475…`、`prev-c1fc17aa` 都还在；端口绑定
  `127.0.0.1:3000`、重启策略 `no` 已写进 `/tmp/nianlife-diag/rollback-7ac9f67-*`。本轮未回滚。
- **冷启动首次响应（真的是第一次，预热之前）**：容器 05:20:30Z 启动，只用 `/api/health` 判就绪
  （健康检查不碰这三个页面），随后按顺序各请求一次，中间没有任何别的访问。四条全部**首次即成功**，
  没有用重试代替首次结果：

  | 页面 | 首次 | TTFB | 字节 | mock 事件链接 | 月份链接 |
  |---|---|---|---|---|---|
  | `/` | 200 | 2.17s | 24,119 | **0** | 2 |
  | `/memory` | 200 | 0.09s | 32,677 | **0** | **21** |
  | `/about` | 200 | 0.07s | 19,052 | **0** | 1 |
  | `/memory/2026/08` | 200 | 2.19s | 132,101 | **0** | 9 |

  对照旧镜像里烤好的 mock：首页曾链接 event-car / event-lake / event-daycare-ball，归档索引只列
  2 个月。现在首次响应就是 0 个 mock 链接、21 个真实月份。三个页面的响应头是
  `no-store`（按需渲染、无路由缓存），月页仍是 `x-nextjs-cache: MISS` + ISR，行为符合设计。
  `/memory`、`/about` 只用了 70–90ms，是因为 2.2 秒前 `/` 那次请求已经把 300 秒档案缓存填好了。
- **08-19 选图**：冷启动那份月页 HTML 里，8 月 19 日整块是
  `<article class="month-moment moment-memory_led">`（**没有 `moment-with-hero`**），
  **零 `<img>`、零 `<figure>`**；事件详情页同样 0 图 0 figure，标题仍在。
  同月对照：整页 `<img>` 从 93 降到 90，正好是那一块的 1 主图 + 2 缩略图；消失的 5 个
  `/api/media` URL 全部属于这三张。8 月 17 日、8 月 18 日的故事各自仍有自己的照片（各 1 图 1 figure），
  **同日/邻日其它故事未受影响**。餐牌照没有被删除或改写：月末档案层仍然声明这个月 30 天 640 张
  照片并提供「展开全部」，它留在那份完整记录里；它在默认首屏本来就没出现过（改动前的 3 次出现
  全部来自 08-19 那一块）。
- **新版本桌面与移动端（Playwright，真实视口）**：390×844（dpr 3，`max-width:600px` 为 true）
  与 1440×900 两档，覆盖 `/`、`/memory`、`/about`、`/memory/2026/08`、08-19 事件页共 10 组：
  **零横向溢出**（最宽元素右边界恰好等于视口宽）、**零坏图**、进入视口的图片全部渲染
  （移动 4/4/1/12/0，桌面 1/4/1/16/0）、`readyState=complete`、无 console 错误。
  三个导航链接点一遍分别 512 / 446 / 448 ms，无异常等待。
- **300 秒缓存的作用范围（结合代码确认）**：`loadFamilyArchiveOnDemand()` 只被
  `/`、`/memory`、`/about` 三个页面调用（结构测试守着），ISR 页面仍调没有缓存的
  `loadFamilyArchive()`，不叠加 TTL。它缓存的是**单一数据源**：`loadFamilyArchive()` 内部按
  `CANONICAL_PROFILE_ID` 收窄，后端由模块加载时的 `resolveRepositoryBackend()` 一次决定，
  没有任何按请求变化的入参，因此**不存在混用不同数据源或不同家庭上下文的路径**（本项目也没有
  登录/多用户上下文）。缓存是进程内的，不跨容器共享。失败会清除：`archive.catch()` 在仍是当前
  条目时立即置空，测试覆盖。

**本轮发现的新问题（未修，见下「阻塞」）**：`revalidatePath()` 清不掉这个进程内缓存。

### 一之二、第 1 步剩余项的修复（2026-09-10 第二轮，代码已在 main）

下面第二节记的四个问题里，前两个已改代码并本地验证，第三个只做了只读检查和方案，第四个已补齐证据。
**这些修复随后已在 7ac9f67 的诊断容器上用真实数据看过了**，见上面「一之一」。

- **月页误配图（已修）**：`EditorialMemory` 新增 `noPhoto` 字段，由
  `heroMediaId === NO_HERO_MEDIA_ID` 直接决定，与 `mediaBindingTrusted` 无关；
  `buildMonthComposition` 的 memory_led 分支从 `!memory.lead` 改成 `!memory.lead && !memory.noPhoto`，
  被审阅为纯文字的故事不再借当天的照片。**范围就是这条故事自己的 moment**：同一天其它事件的
  合法照片照旧，当天散落的照片照旧留在月末档案层，没有删除或修改任何媒体行。
  回归测试三条：`test/publication-moments.test.mjs` 两条（哨兵事件零主图零缩略图 + 同日另一事件
  仍有自己的照片 + 两张照片都还在档案层；以及「未设 heroMediaId 仍然借图」的 T11 Part C 护栏），
  `test/memory-chapters.test.mjs` 一条（`noPhoto` 区分「已审阅无图」「未设置」「尺寸不达标」）。
- **首页 / 归档索引 / 张年页构建期 mock（已修）**：新增 `lib/render-on-demand.ts`，三个无参数页面
  `/`、`/memory`、`/about` 调 `connection()` 退出构建期预渲染。**`/about` 是本轮顺带查出来的同一
  类缺陷**（镜像里也有 `about.html`），一起改了。构建产物已核对：`.next/server/app` 里
  `index.html`、`memory.html`、`about.html` 全部消失，`build` 输出把三条路由标为
  `ƒ (Dynamic) server-rendered on demand`；只剩 `_not-found`/`archive`/`timeline`/`capture` 四个
  不读库的静态壳。这三页因此没有 Next 路由缓存了，所以档案读取改走
  `loadFamilyArchiveOnDemand()`（`lib/family-archive.ts`，300 秒 TTL、缓存 Promise 让并发首请求
  共用一次读、失败立即失效），**不是靠缩短刷新间隔**，也没有让 ISR 页面多一层 TTL。
  测试 `test/render-on-demand.test.mjs` 五条，其中一条是结构护栏：任何无参数页面只要读档案又不
  调 `renderOnDemand()`，测试就红。
- **验收口径**：「新构建首次请求即真实数据」只能在接 RDS 的私有容器上验；本地构建用的是 mock
  store，只能证明这三页不再有构建期 HTML。**这一条留给该 SHA 的私有容器验收。**

### 二、2026-09-10 第一轮补验发现的问题（历史记录，1 和 2 已在 7ac9f67 上修复并验收，3 仍未交付）

1. **08-19 的误配图在月页上仍然在。** `/events/event-v2-80445fc5d6c717f30f10b9e0403d1d76`
   详情页确实只剩文字、零 `<img>`（哨兵值 `hero_media_id='none'` 生效，且该事件的三张附件
   全部 hero-eligible，所以这就是 `d3efa81` 生效的反证）。但 `/memory/2026/08` 的
   **8 月 19 日整块仍渲染一张页宽主图 + 两张缩略图**，主图就是「好好吃饭吧」餐牌照，
   缩略图之一正是被摘掉的 `wechat-media:f919…967`。截图见本轮回执。
   **原因**：月页的图片绑定走 `lib/publication-moments.ts`，它按「当天媒体 + 尺寸 + privilege」
   选 `hero`/`supporting`，**从不读 `heroMediaId`，也不认识 `NO_HERO_MEDIA_ID`**；哨兵值只被
   `lib/media/presentation.ts`（详情页）和 `lib/memory-chapters.ts`（章节 lead）消费。
   上一轮回执里「08-19 月页确认只剩文字、无图」这句，按现在的页面**不成立**。
2. **首页和归档索引仍然在构建期烤进 mock。** 镜像里 `/app/.next/server/app/index.html`
   （13,141 bytes）内容是 mock：链接 `/events/event-car`、`/events/event-daycare-ball`、
   `/events/event-lake`，正文是「追着哥哥姐姐一起踢球」等种子数据；`memory.html` 只列
   2026/07、2026/08 两个 mock 月份。运行期 ISR 刷新后才变真（现在首页真实、归档索引列出
   2025-01 → 2026-09 共 21 个月，三个 mock 事件 URL 均 404）。也就是说 `8b8b582` 只堵住了
   月页这一条路径，**`/` 和 `/memory` 在每次容器启动/新部署后的头 5 分钟仍会先发 mock 页**。
   这正好打在原则一的检验句上（第一次打开的家人看到什么）。
3. **视频仍然不可交付。** 121 条 video media（29 条挂在事件上），
   `media_assets`+`media_locations` 里 video 只有 `wechat/original/ready` 120 条，
   **任何 provider 都没有 poster / preview 派生**，所以 `/api/media?variant=web|thumbnail|poster|preview`
   四种全部 404。好消息是呈现层确实把它们扣住了：2025-11 月页和挂着视频的那个事件页
   **零 `<video>`、零对该 media 的引用**，读者看不到坏元素。这是既有状态，不是本轮改动造成的。

### 二之二、视频缺口：只读检查结论（本轮不转码、不迁移、不改存量记录）

三个状态必须分开说，混成一句「视频没有」会把该做的事说错：

| 状态 | 结论 | 证据 |
|---|---|---|
| 原始文件存在 | **是** | 代表视频 `20251113_112533_4077.mp4` 在 `E:\WechatHis\texts\群聊_…\media\videos\` |
| 原始文件可读 | **是** | 本地读出 943,379 字节，sha256 `ff481dfb…5c14`，与 `media_assets.checksum` 完全相同 |
| 页面可播放 | **否** | 见下面三个各自独立的缺口 |

- **缺口一：任何 provider 都没有视频派生。** 120 条 video location 全是
  `wechat/original/ready`，`archive_status` 全是 `awaiting_archive`，`provider_ref` 是
  219 字符的摘要三元组（`wechat:document:<sha>:path:<sha>:ref:<sha>`）——**它不是可读地址**，
  `getStorageForProvider("wechat")` 按设计直接抛错。视频字节从来没有进过 R2 或 OSS。
- **缺口二：派生生成链路对视频是占位图。** `lib/media/processing.ts` 的 `createDerivatives()`
  遇到 `mediaType === "video"` 返回一张写着「视频预览稍后可用」的 SVG，**没有抽帧**。
  机器上没有 `ffmpeg` / `ffprobe`（Playwright 缓存里带了一个 `ffmpeg-1011`，但那是它自己录屏用的）。
- **缺口三：家庭页面根本没有播放器。** `lib/media/deliverability.ts` 写明「a video is only ever
  shown through its poster (there is no inline player on a family page)」，全仓库没有 `<video>`。
  所以就算补了 poster，视频也只是变成一张静止图。

**最短可播放方案（一个代表性视频，四步，估算改动很小但含一个产品判断）**：

1. 用文件名把 DB 行对回硬盘原件（已验证可行），SHA-256 复核后再用；
2. 装 ffmpeg，抽一帧做 `poster`（webp），转一份 faststart H.264/AAC 的 `preview`（mp4）；
3. 两个派生按现有 key 规则传 OSS（`media/derivatives/<assetId>/poster.webp`、`preview.mp4`），
   插 `oss/poster/ready`、`oss/preview/ready` 两行 location。**`/api/media` 不用改**：
   `preferredVariant()` 对 video 已经是 `["preview","poster"]`，`providerRef` 也满足 `media/` 前缀；
4. **需要新增一个小播放器组件**（`<video controls poster=…?variant=poster src=…?variant=preview>`）
   并接进 PhotoGallery / evidence 列表。这一步是产品判断，不只是工程：一旦 poster 就绪，
   `deliverableMediaIds()` 会立刻把这些视频放进页面和计数，**在没有播放器之前它们会以静止图出现**。

**两条订正（2026-09-10，避免这份记录被当成结论用）**：

- 上面「原始文件存在 / 可读」只对**这一个抽样文件**成立。它证明的是：这条记录能对回硬盘上的
  一个真文件，且字节与库里的 checksum 一致。**不能据此推断其余 120 条视频都存在或都可读。**
- `E:\WechatHis` 下有 665 个 mp4、库里有 121 条 video media，**这两个数字不能相减得出缺失量**，
  也不能据此判断差额属于哪些会话：两边的口径、去重方式、时间范围都没有对齐过。留给第 2 步的
  集合对账，本轮不推导、不扩张排查。

### 三、未确认 / 阻塞

- **新问题：按需 revalidate 到不了这三个页面了。** `scripts/nianlife-worker.mjs` 每轮写完内容都会
  POST `/api/internal/revalidate`，路径集合**固定包含 `/` 和 `/memory`**，目的是「不用等 300 秒
  ISR 窗口，新内容立刻可见」。这两个页面现在是按需渲染，没有路由缓存，`revalidatePath()` 因此
  没有东西可清；而它**清不掉 `loadFamilyArchiveOnDemand()` 的进程内 300 秒缓存**（那是普通模块
  状态，Next 不知道它存在）。结果：worker 推送之后，首页和归档索引最多仍会晚 300 秒才变。
  今天不咬人（`ORGANIZER_WORKER_ENABLED=false`，本地 worker 没在跑），但**第 5 步恢复 worker 前
  必须先修**。最小修法是让 revalidate 路由在收到这三个路径之一时顺手清一次那个缓存
  （`lib/family-archive.ts` 已经有清除函数，只需要一个非测试专用的导出）。
  **本轮没有改**：改了代码就不再是刚验收的这条 SHA，留给下一轮。
- **视频：未交付。** 本轮按指令**没有**安装 ffmpeg、没有转码、没有上传、没有写库、没有做播放器。
  状态与上一轮相同：任何 provider 都没有视频派生，四种 variant 全 404，呈现层扣住、页面无坏元素。

- **移动端已补验通过**（改用仓库里已装的 Playwright，真正设置渲染视口）：`innerWidth=390`、
  `devicePixelRatio=3`、`matchMedia('(max-width: 600px)')` 为 **true**。首页 / `/memory/2026/08` /
  08-19 事件页在 390×844 与 1440×900 两档下：**零横向溢出**（最宽元素右边界恰好等于视口宽）、
  **零坏图**、零请求失败、`readyState=complete`；进入过视口的图片全部渲染成功
  （移动 14/14、桌面 20/20）。折叠区之外的懒加载图片始终不加载，这是 `loading="lazy"` 的正常
  行为，不是失败。此前浏览器扩展工具的 `resize_window` 改不动渲染视口（`innerWidth` 恒为 2560），
  那条「未确认」到此解除。
- **凭据轮换**：上一轮排查诊断容器时曾把完整环境变量（含 RDS 密码、OSS AccessKey）打印到
  会话终端。**单独待办，本轮未处理**，是否轮换由 Teddy 判断。
- **数据账本**：等已有的只读收敛结果，**不重开同一次盘点，不执行 222 条全量任务**
  （八月那份 222 条清单已确认全部入库、缺口 0，见 STATUS「更正三」）。

### 四、边界与回滚（本轮均未执行）

- **OSS 完成范围**：只覆盖固定的 `variant IN ('thumbnail','web') AND status='ready'` 派生集合，
  **不代表全部原图和视频归档完成**。旧来源保留，**不退役 R2**。
- **镜像回滚与数据回滚相互独立**：换回旧 image tag 不会撤销 RDS 里 `hero_media_id='none'`
  那一行；要回到本轮改动前的完整状态，两件事都要做。本轮不执行回滚。
- **公开切换阶段**：仍需先制定保护 RDS 新写入的方案（回滚数据会覆盖切换后产生的新写入），
  该方案尚未制定。
- 备案前继续 loopback + SSH 隧道，不开公网入口。18080 隧道由其他 session 维护，本轮只复用。

---

> 2026-09-07 总指挥迁移通知：下方 9/6 停工、计划与库数字为旧时点记录。迁移当前证据见 `nianlife-P2-backup-execution-2026-09-07.md` 第 18 节：本机模拟通过，生产备份未在此确认完成。先读 `COORDINATION.md`、`COMMANDER-OUTBOX.md`；Cowork 请按 CMD-20260907-001 接入并刷新本页摘要。允许本轮协调与离线准备，生产权限不扩大。

> 最后更新：2026-09-07 22:27 CST，由 Cowork 维护（CMD-20260907-001 ACK 已写，三轨迁移任务已派单，等待三轨 ACK）。**本文件是唯一权威版本**（见第 3 节
> "编排检查"踩过的坑——claude.ai Project 里同名文档只作只读镜像，方便手机翻，
> 不保证被定时/触发式 session 读到，不要以它为准）。
> 这是一份**活文档**，不是某个时刻的审计快照。docs/ 下那些带日期的报告是历史，不要拿来当现状。
> 数字会过期——写生产之前一律重新查库，不要引用本文的数字当实时事实。

## 0. 新 Session 请按这个顺序读

1. 本文 `docs/STATE.md`（当前状态、已定决策、踩过的坑）——**不是** claude.ai Project 里的
   `claude/nianlife-STATE.md`，那份是镜像，触发式/定时 session 大概率读不到。
2. `docs/nianlife-product-principles.md`（长期产品原则，任何产品/UI/IA 工作前必读）
3. `CLAUDE.md`（仓库边界、Git 授权、工程执行纪律）
4. 需要时再翻 `docs/` 下带日期的报告——它们是快照，只在考据具体历史时有用

不要重新做一遍"考古"。本文第 3 节的坑都是真金白银踩出来的。

## 1. 当前位置

### 🛑 全项目停工中（2026-09-06 08:3x UTC）——生产库被人为切断，这是决定，不是故障

**在读下面任何内容之前先知道这件事**：Teddy 已把 Neon 从 Launch **降级到 Free**。本计费周期
（9/5–10/1）出站流量已用掉 1.37 TB，Free 版每月只有 5 GB，**超额 270 多倍**，所以生产库现在
硬性拒绝连接（实测报错：`Your project has exceeded the data transfer quota.`）。nianlife.cn
因此打不开，缓存过期后会陆续变报错。**数据没有丢**——Neon 的限额只封操作、不删数据。

起因是这一天之内 Neon 账单烧到 $87.86（见第 3 节"数据库"小节的事故记录）。Teddy 的原话是
彻底修好之前不会再付一分钱。**恢复与否只由 Teddy 决定**（10 月 1 号计费周期自动重置，或他主动
升级），任何 session 不要替他决定、不要催、不要试图绕开。

**三轨（A/B/C）已全部下达停工指令**（写在三个 `docs/ORCHESTRATOR-INBOX*.md` 顶部）：不跑任何
连生产库的东西、不访问 nianlife.cn 做"验证"、不因为看到 DB 报错去改代码或连接配置、不 push
（push 会触发注定失败的 Vercel 构建）、不开新任务。

**P0 事故本身已收尾，不需要任何人再动它**：A 的查询修复 `7d7fe15` 在 main 上；C 修好了自己
引入的 Ignored Build Step 致命命令（那条命令曾让约 6 次部署全部 Error，导致修复迟迟没上线）；
C 的 revalidate stopgap 已干净撤回（`5684d91`）。Cowork 已从 GitHub 独立重新 clone 复核 main：
`loadFamilyArchive()` 确实改用了 `getAllEventIdentities()`，5 个页面 `revalidate` 干净回到 300，
无误伤。**唯一没被 Cowork 独立验证的是"这个构建真的成为了生产别名"**——C 用
`vercel inspect nianlife.cn` 查证过（这是对的证据类型），但 Cowork 侧的 device_bash 没有 Vercel
登录态，复核不了，如实标注。

**下次恢复 Neon 时的第一件事**（写给未来的任何 session）：恢复后先盯 30 分钟出站流量曲线，
确认没有重新爬升，再让三轨复工。不要恢复完就直接开跑。


**P1 ✅ 全部通过并结案。2026-09-06 起进入 P2，三条轨已派单（A-6 / B-17 / C-5，见下）。**
INGESTION_TOKEN 已打通（Cowork 验证 revalidate 返回 200）。worker 首次全量导入 **Teddy 说先放着**，今天不跑。

### P2 是什么（`claude/nianlife-P1-P2-plan.md` §2 定的，退出标准别改）

> **目标：苏静能把 2025 年从头翻到尾，并说一句话。那句话决定 P3 是什么。**

P2 四块：2025 逐月回填（A-4 已完成）· **月章节排版（图文交错，不再是文字一坨 + 折叠档案）** ·
首页成为封面 · 2025 年度书 V1。不做：Resurfacing、同龄对比、商业化、登录。

### 今天（2026-09-06）三轨分配

| 轨 | 任务 | 一句话 | 依赖 |
|---|---|---|---|
| A | **A-6 痕迹层数据** | 从 2025 的 store_only 里挑出主体明确指向张年的子集，标记为「可轻量展示」 | 无，立即开始 |
| B | **B-17 月章节三层排版** | 章节 / 段落 / 痕迹三层权重；消灭空日期列表；照片进正文 | 排版可先用 store_only 全集开发，不等 A-6 |
| C | **C-5 图片交付性能** | 解决 `variant=web` 5-7s；给 B 轨 variant/尺寸结论 | 无依赖，但**必须先于 B-17 上线** |

**今天唯一的跨轨硬依赖**：B-17 会把正文图片数量从个位数拉到几十张（2025-12 有 359 张，
2026-08 有 664 张），所以 C-5 必须在 B-17 上线前落地，否则 B 一上线就是慢页面。
文件所有权分区不变（A: `lib/**` `scripts/**`；B: `components/**` `app/**/page.tsx`；C: `app/api/media/**`），
三轨并行不冲突。

### P2 的核心产品判断（Cowork 2026-09-06 定，不用重新讨论）

**月章节分三层，不是「发布 / 消失」两态。**

实查依据：2025-06 全月 13 条 life_events，1 条 approved、12 条 store_only。逐条读过那 12 条
（「妈妈夸小年白得逆光都不怕」「哄睡哄了将近半小时」「张小年今晚跟小雪睡」……），
**绝大多数是真的关于张年的日常**，只是分级判为 low，不是主体门误判。
现在它们在页面上完全不出现，`/memory/2025/06` 只剩「1 段记忆 + 10 个光秃秃的空日期 + 折叠的 98 张照片」。

- **章节**（approved 高 worthiness）：大版面，标题 + 正文 + 当天照片
- **段落**（approved 其余）：中等版面
- **痕迹**（store_only 里主体明确的子集）：一行短句，轻量呈现

原则五要的是**用视觉权重表达差异**；把「权重差异」做成「有和无」是过度执行。
但「宁可没有，不要错的」仍然成立，所以痕迹层必须有自己的门 = A-6 的活。
**痕迹层不等于放宽 approved**——approved 是发布层，痕迹是展示层的另一个更低门槛，两者不能混。

- **A 轨（数据管道）**：入箱 `docs/ORCHESTRATOR-INBOX.md`，出箱 `docs/STATUS.md`，交接稿 `docs/HANDOFF-A.md`。
  **A-4（2025 全年回填 life_events）已完成，A-5（补4个月snapshot）也已完成**
  ——12 个月全部有 life_events（见第 4 节），过程中
  抓到并修复了一个真实的主体门误判（猫和孩子撞昵称，见第 3 节）。**A-5 结论**：2025-02/03/05/06
  这 4 个月**不是遗漏**——已发布（published）life_event 只有 4/3/2/1 条，低于 5 条阈值，
  `month-review.mjs` 按既有规则正常跳过写库，`monthly_snapshot` 维持 16 个月不变，是设计生效，
  不是缺口。（此前 STATE.md 给的 23/14/11/13 是这 4 个月 life_events **总数**，含大量 low 级
  not-about-child 行，跟"已发布数"不是一回事，是本文档自己算错了对比口径，已更正，见第 6 节。）
  夸克入库卡在 HEIC 解码器（P1-2b，214/1,690 非 HEIC 已入，1,468 张 HEIC 阻塞）。
  微信原始数据全部导入完毕（含 7,244 条消息那个大会话，raw_sources 46,742 已包含），
  **但 `nianlife-worker.mjs` 这个新自动化脚本自己的"首次正式跑"还没做**（它的增量基准是独立的，
  首跑会把已有数据当新的重新扫一遍——这是已知的一次性成本，不是 bug，见第 3 节）。
- **B 轨（渲染/UI）**：入箱 `docs/ORCHESTRATOR-INBOX-B.md`，出箱 `docs/STATUS-B.md`，交接稿 `docs/HANDOFF-B.md`。
  B-1~B-16 全部完成并线上验收通过。入箱空，**可以 /clear**。
- **C 轨（性能/缓存）**：入箱 `docs/ORCHESTRATOR-INBOX-C.md`，出箱 `docs/STATUS-C.md`，交接稿 `docs/HANDOFF-C.md`（2026-09-06 新建）。
  C-1~C-4 全部完成并线上验收通过。入箱空，**可以 /clear**。

**需要 Teddy 拍板的一件事（见第 7 节）**：
1. `nianlife-worker.mjs` 首次正式跑——手动跑一次，还是挂 Windows 定时任务？

**已解决**：`INGESTION_TOKEN` 已由 Teddy 分别填进 Vercel 环境变量和 `v2/.env.local`（2026-09-06）。
Cowork 用本地 .env.local 里的值直接 POST `/api/internal/revalidate`，返回 `200 {"revalidated":["/"]}`，
链路已打通。注意：`dotenv`/`dotenvx` 会自动去掉 .env 文件里值两边的引号，
用普通 shell `grep|cut` 读这个值会把引号也读进来导致误判成"没打通"（第一次验证时踩过），
之后要验证类似 token 一律用 `node -e 'require("dotenv").config(...)'` 读，不要用裸 shell 解析。

四个阶段：0 导入与可读 → 1 审阅台 + recall-first → 2 本地 worker 自动化 → 3 回到 2025 年 + 出版物质感。
**阶段 0~1 完成，阶段 3（2025 回填）life_events 部分完成，阶段 2（worker 首跑）待 Teddy 拍板。**

## 2. 已经定下的决策（不要重新讨论）

1. Organizer 改为 **recall-first + 人工审阅台**；claim grounding / narrative validator 保留为对每句话的约束，不再作为"要不要出候选"的门。
2. **无文字月份默认放照片**（已实现，commit `83b9001`）。
3. Organizer 搬到 Teddy 电脑上的**本地 worker**，Vercel 只做渲染和审阅台（阶段 2）。
4. 40 条测试残留（`msg N <epoch>`，2026-08-31，4 个合成会话 label）**不删除**，在读取层过滤。
5. Gemini / OpenAI-compatible provider **不删除**，但生产统一 DeepSeek，其余不再维护。
6. 陈亚萍私聊判定为低价值：已入库的 2,795 条**保留不删**，但已加入排除名单，不再更新；阶段 1 组织时也要排除它。
7. 整理与出版**从最近月份做到最旧**（2026 → 2025），但导入不分先后、一次全导。**2025 全年回填（A-4）已完成执行**。
8. **01 月内容阈值不降**，接受内容少的现状原样展示。
9. **About 页 portrait 应优先选人像照片** ✅ 已完成（commit 5798b7e）。
10. **Neon 已升级到 Launch 计划**。存储上限 10 GB，按量付费，不设 consumption limit。
11. **首页回退到有 snapshot 的最近月份** ✅ 已完成（commit 5798b7e）。
12. **P1 判定通过，P1-6 真机验收挪到 P2 之后**。worker 代码已合入 main 且逻辑自洽，真机首跑是运维执行，不卡 P1/P2。
13. **视觉方向以 Teddy 2026-09-05 设计稿为准**：大地色 + 全圆角 + 呼吸感微动效（`docs/design/visual-system-v2.md`）。旧版编辑部风移到 `_superseded/`。
14. **「代表照/封面照」只认夸克家庭相册**：唯一入口 `v2/lib/media/representative.ts` 的 `isPortraitOfZhangnian(media)` = `media.id.startsWith("media-quark-sha-")`。事件页 hero 和月页正文当天的照片不受此限。
15. **公开阅读页走 ISR**（`revalidate=300`）：`/`、`/about`、`/memory`、`/memory/[year]`、`/memory/[year]/[month]`；`/inbox` 保持实时。写完库要立刻可见走 `POST /api/internal/revalidate`。
16. **配图支持的叙述性描写（含引语）是可接受的，不算编造**（Teddy 2026-09-06 拍板）。
    写手是**多模态**的：判断一段文字是不是虚构，基准必须是「**文字证据 + 配图**」，
    **不能只比 `raw_sources.text`**。照片里是雪姨在开车，写手补一句「妈妈喊了一句『雪姨在开车！』」，
    属于可接受的叙述，不是幻觉。Teddy 的原则是「不接受有图没文字」——**看图生成文字本来就是设计内的正确行为**。
    仍然算错的只有两类：(a) 完全没有配图、文字证据也不支持的具体断言（例如把转发的带货广告
    写成孩子自己的数据）；(b) 精确到序数/数量的事实断言而证据无法可靠支撑（例如「第七颗牙」，
    存疑但不急着改）。**这条不要重新讨论**——2026-09-06 A-7/A-8 曾用"只比文字"的错误基准
    判出 13 条"编造"，几乎让好内容被删掉，是 Teddy 本人纠正的。
17. **编排的状态文档以本仓库 `docs/STATE.md` 为唯一权威**，claude.ai Project 里的同名文档只是给 Teddy 手机上看的镜像（2026-09-06 定，见第 3 节踩坑记录）。
18. **心跳类 commit（每 5 分钟中间进度）不要每次都 push，只 commit**（2026-09-06 定）。
    起因：2026-09-06 当天 100 个 commit 里 89 个是纯 docs/心跳，只有 11 个是真代码，
    Vercel 按 GitHub push 事件排队构建，不看内容是不是 docs——队列被心跳 commit 挤到几十条，
    真正要紧的代码修复（例如 `989cd11`）排在后面等构建。**改法**：心跳正常写、正常本地 commit，
    但只在「真代码/真数据变更」「攒够约 30 分钟心跳」「任务正式完成」「Cowork 明确要求」这四种
    情况下才 `git push`。已写进 A/B/C 三份 `ORCHESTRATOR-INBOX*.md`。
19. **C-6 图片预热方向放弃，不再追加投入**（2026-09-06 定，C 轨实测）。Vercel 共享边缘缓存
    对我们这种"几千张互不重复、访问量很低"的长尾图片，实测约 4-5 分钟就会被驱逐，跟
    `Cache-Control: max-age=31536000, immutable` 响应头无关（该头只管新鲜度，不管边缘
    保不保留）。"提前焐热等未来某个不确定时刻苏静打开"这个前提在默认 Vercel 边缘缓存上
    不成立——只要预热和真实打开之间隔几分钟以上，效果就没了，这不是改预热脚本/并发/
    覆盖面能解决的。**换图片托管方案（如 R2 自定义域名）是本轮明确排除的红线，不做**；
    Vercel 更高缓存保证的付费层级未验证是否可行/值得，需要 Teddy 拍板，不默认追加。
    **现阶段依赖 C-5 的冷启动优化**（流式响应、精确查询替代 `getStore()` 全表扫）作为
    实际用户体验的主要保障，C-6 预热工具本身可以留着（不删代码），但不再作为验收指标。

## 3. 踩过的坑（最有价值的一节）

**微信导入**
- **source root 必须是 `E:\WechatHis`，不是 `E:\WechatHis\texts`。**
- **绝不能用 `--max-media` / `--max-messages` 压缩单次工作量**——照片会永久丢失。
- 会话序号不稳定，稳定身份是 documentDigest。
- **租约过期 ≠ 进程死亡**，`chat-import-state.ts` 的 claim 会自动捡起断点，不要手动改数据库状态。
- 导入不会 enqueue Organizer；Quark ingest 会。
- **P1-6 worker 首跑 = 全量重扫，不是真增量。** worker 自己的增量基准跟旧版手动导入脚本的状态文件是两套独立系统，互不认账。首跑日志会显示"first run — full import"，把已导入过的数据当新的全部重新扫一遍（按 documentDigest 去重，不会真的重复写入，但会很慢）。**这是设计上的一次性成本，不是 bug**，挑一段能整晚开着电脑的时间做首跑。
- **首跑的实际影响比字面小得多（Cowork 2026-09-06 读脚本确认，不要凭直觉判断）**：
  - `created === 0 && mediaCreated === 0` 时，**Phase 2-4 整个跳过**——不跑 Organizer、不重生成 monthly_snapshot、不 revalidate。硬盘上没新东西的话，首跑就是一次几小时的只读扫描，**不花 API 钱、不动任何已有内容**。
  - 真扫出新消息时，只有「本次真正写入的行所在的月份」会被重新 Organize（affected months 是按 `raw_sources.created_at >= 本次启动时间` 查的），不是全量重跑；已组织过的窗口有指纹短路会跳过。
  - **唯一的破坏性写操作：受影响月份的 `monthly_snapshot` 会被覆盖重写**（`persistMonthlySnapshot` 是 upsert）。所以某个 2025 月份一旦被扫出新消息，A-4 验过的那份月度回顾会被重新生成，**必须重新抽读**。
  - **`--since=YYYY-MM-DD` 可以绕过全量重扫直接建基准**：不带 `--no-state-update` 跑一次窄区间，`worker-state.json` 的 `lastRunAt` 就写上了，之后就是真增量。代价是放弃「全量重扫顺带核对源数据完整性」这个副作用。这几个 flag 原本标注为「仅供手动 bounded 测试」，这么用属于 off-label 但机制上成立。

**Quark 入库（P1-2）**
- 87% 是 .HEIC，sharp/libvips 在 Windows 上无法解码，静默崩溃。`heic-convert`（纯 JS/WASM libheif）已验证方案，1,468 张待转码入库。
- 巡检 SQL 要用 `source_label = 'Quark 历史素材 2026-09-03'` 精确匹配，不要 `LIKE '%Quark%'`。

**数据库**
- `DATABASE_URL` 是 pooled 端点，`DATABASE_URL_UNPOOLED` 直连。
- `pool.on("error")` 已加，防止空闲连接掉线导致未捕获异常。
- `getStore()` 每次渲染 18 条无 LIMIT 查询——P1-5 已修，排除大列 + 跳过管道专用表。
- **P1-5 的修复范围只覆盖了 `assembleStore()`，没覆盖 `assembleOrganizerStore()`**（2026-09-06
  真实发生，代价是 Neon 账单一天内多花 $87+ 的出站流量）。`assembleOrganizerStore()` 自己的
  注释写明"只给 Organizer 内部读取路径用，页面渲染不该调它"，但 B-17 的 commit `2f65c78`
  把 `getOrganizerStore(profileId)` 加进了 `lib/family-archive.ts` 的 `loadFamilyArchive()`——
  这个函数在 5 个页面组件的顶层直接 await，每次 build/ISR 重渲染都把 `raw_sources.text`
  （64 MB，全库最大列）整表拉一遍。**教训：任何要在页面渲染路径上新增的数据读取，都要检查
  调用的函数是不是专门为批处理/后台任务设计的"全量读取"函数**（这类函数的文档注释通常会
  写清楚使用边界，比如这次的"callers outside the Organizer's own read path must use getStore()
  instead"——这种警告是真的，不是防御性文档）。修复：加一个只查 `life_events`（按
  profile_id，不按 visibility）的轻量函数替代整个 `getOrganizerStore()` 调用。
  **已修复并推上 origin/main，但截至 2026-09-06 08:1x UTC 尚未真正部署到线上（见下方
  更正）**：A 轨
  commit `7d7fe15` 加了 `Repository.getAllEventIdentities(profileId)`（只查 life_events
  的 id/title/story/occurredAt 四列，两个后端实现都补齐），`loadFamilyArchive()` 换用它。
  Cowork 独立核实：①用 git clone 单独拉一份 origin/main（不信任本地缓存的 remote-tracking
  ref）确认 7d7fe15/88f7be7 真的在远端主干；②通读 publication-moments.ts/memory-chapters.ts
  里 buildTraceNotes/isGarbageLifeEvent/memoryTitle 的实际取值，确认 trace 事件真的只用得到
  这四个字段，跟 A 报告一致；③生产环境实测：把 /、/about、/memory、/memory/2026/07、
  /memory/2026/06 几个已过期（age>300s）的 ISR 页面手动打一遍，全部在 30~130 秒内
  x-vercel-cache 从 STALE 变回 HIT 且 age 归零——旧的 getOrganizerStore() 查询要 80 秒以上，
  大概率会撞 Vercel 函数超时导致重新生成失败，这次全部干净成功，行为上印证新的快查询路径
  已经在线上跑（**这个结论后来被推翻，见下方 08:1x UTC 更正——这个推理本身有漏洞：
  seq_scan/age 这类间接信号测的是"有没有发生一次全表扫描"，量不出到底是旧的
  getOrganizerStore() 那条带 text 大列的查询、还是修复后不带 text 列的 assembleStore()
  常规查询，两者行为上都会让 STALE→HIT、age 归零，光看这个测不出线上到底跑的是哪个版本**）。
  **另发现两个衍生尾巴，不紧急，记录待后续任务处理**：
  (a) getEventDetail()（postgres-repository.ts 约 411-565 行，事件详情页用）有同一形状的
  问题——db.select().from(t.rawSources) 不带列筛选也不带 WHERE，整表含 text 列都拉出来
  在 JS 里按 sourceIds 过滤，跟这次修的 bug 是同一个模式，只是没被这次事故牵连（详情页
  流量小得多）。建议之后比照 getAllEventIdentities() 的做法给它也加个 scoped 查询。
  (b) 除 A 轨这条真正的修复外，另一个 session（commit cb1d634，独立于 A 轨）在 A 轨已经
  修完 13 分钟后又追加了一条止血提交，把这 5 个页面的 ISR revalidate 从 300 秒改成了
  3600 秒——本意是给真正的修复争取时间，但落地时真正的修复已经上线，属于没查 git log
  就重复动手的协作缝隙（无害，3600 秒目前反而是多一层保险，但按它自己 commit message 里
  写的，等确认稳定后应该有人把这 5 个文件的 revalidate 改回 300）。
  **🚨 08:1x UTC 更正：以上"已确认部署生效"是错的，实际还没部署，钱可能还在烧**。
  Cowork 起初只看了 STALE→HIT + age 归零当证据，但这测不出线上跑的是哪个版本（见上面
  两段加的括注）。后来看到另一 session commit `6c59750`：用 `vercel inspect --logs`
  直接查到过去 1 小时内至少 5 次部署全是 `Error` 状态，卡在 Ignored Build Step 那条命令
  自己报 `fatal: bad object`（`$VERCEL_GIT_PREVIOUS_SHA` 在这次构建的浅克隆里解析不到），
  Vercel 把这种脚本崩溃当成部署失败，不是"跳过构建"——线上卡在 2 小时前的旧构建，
  `7d7fe15`（真正的修复）和 `cb1d634`（revalidate 300→3600 止血）**都没有真正上线**。
  Cowork 独立核实了这个结论（不只信这条 commit 的自述）：连续观察 `/`、`/about`、
  `/memory` 几个页面的 `age`，如果 `cb1d634` 真的上线了，revalidate 应该是 3600 秒，
  但实测这几个页面在被打过一次之后大约 300~360 秒又重新变回 STALE——跟旧的
  `revalidate=300` 完全吻合，跟 3600 秒对不上，说明这几个页面用的还是旧构建。
  **现在唯一要做的事，只能 Teddy 手动做**：打开 Vercel 网页 Settings → Build and
  Deployment → Ignored Build Step，把里面的命令换成：
  `git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .`
  换完之后触发一次新部署（推一个空 commit，或者在 Vercel 网页手动点 Redeploy），
  部署成功后 Cowork 会再核实一遍。这个字段没有任何 session 能远程改，卡住的原因不是
  代码问题。

- `monthly_snapshot` 只有 `id/profile_id/month/summary/highlights/visibility/created_at` 七列，**没有 status、没有 month_date**，`month` 是文本列。

**Git / 环境**
- 工作区大量文件显示 modified，**全是 CRLF/LF 差异**，`git add -A` 绝对禁止，只加自己的文件。
- **device_bash 里跑 git 会留 `.git/index.lock`**（沙箱删不掉）。用 `GIT_INDEX_FILE=$HOME/.git-index-tmp` 建临时 index：先 `git read-tree HEAD` 填充，`git add` 指定文件，`git -c user.name="Ted" -c user.email="teddyyongteng@gmail.com" commit`，最后 `cp $HOME/.git-index-tmp .git/index` 把真实 index 同步回 HEAD，避免下一次 `git status`/`git add` 因为真实 index 是脏的而出现诡异的 `MM`/`D`/`??` 混乱状态。
- **僵尸 git 锁不要空等。** 0 字节且超过 30 秒的锁（`.git/objects/maintenance.lock` 或 `.git/index.lock`）基本是僵尸锁，直接绕过或删除继续，不会有人来通知。
- **不要把大文件提交进来**（曾有 241MB 的 skills.zip 进历史，用 `git reset --soft origin/main` 退回处理）。
- **Cowork 用 Python `open(path,"r")`/`"w"` 文本模式改 CRLF 文件会把整个文件转成 LF**（2026-09-06 真实发生：改 `ORCHESTRATOR-INBOX-B.md`/`-C.md` 各两三行，diff 却是全文件2558/791 行改动）。内容没丢，只是行尾风格被悄悄改了——不是新 bug，是同一个 CRLF/LF 假改动，只是这次是 Cowork 自己的安全替换脚本触发的，不是 `git add -A`。**以后用 `open(path,"rb")`读、`.encode("utf-8")` 写（不用文本模式）**，或者用 `newline=""` 打开，保留原始行尾。

**部署 / 验收**
- **本地代码 ≠ 线上部署。** 判"没生效"前先确认线上跑的是哪个构建：抓 `/_next/static/css/<hash>.css` 的 hash 对比。
- **`/api/media/[id]` 曾经每张图都调 `getStore()` 全量读取层**导致空灰框，已改 `getMediaForDelivery(id)` 精确查询修复（C 轨 `bd63bb7`）。
- **内联 `style={{aspectRatio}}` 会压过 CSS 固定高度。** `Photo` 组件加了显式 `fit` prop（`natural`/`crop`）解决。
- **公开页 ISR revalidate=300**，`x-vercel-cache: HIT/STALE` + `age` 大 = 看的是缓存页，判断前先看 age。
- **Vercel「Ignored Build Step」不在 Settings → Git，在 Settings → Build and Deployment。** Cowork 和 C 轨都凭印象猜成 Git 标签页，Teddy 自己截图去 Git 页确认没有这个字段才发现猜错，最后查 vercel.com/docs/project-configuration/project-settings 官方文档核实。教训：Vercel 设置项的具体位置不要凭经验/训练记忆断言，去官方文档核实一次成本很低，猜错了让用户在网页里空转找。

**编排 / 多 session 协作（2026-09-06 新增）**
- **定时/触发式 session（`create_trigger` 起的）不一定挂在 claude.ai Project 下**——即使当初创建它的对话是挂着 Project 的。这类 session 读不到 `claude/nianlife-STATE.md`（Project 文档），如果 prompt 里让它读这个路径，它可能会静默地把它当成仓库相对路径处理，读到/写到一个完全不相关的旧文件（这次真实发生过：读到了 `docs/STATE.md`——一份 2026-09-05 之前就废弃、只有 7 条决策的旧版草稿——并往里面写了新数字，跟真正的活文档完全脱节）。**解法：状态文档唯一权威版本改成本仓库内 `docs/STATE.md`（git 追踪，任何 session 不管挂不挂 Project 都能读到），claude.ai Project 里的同名文档降级为镜像。**
- **Cowork 侧的 git 操作要小心真实 index 和临时 index 不同步。** 用临时 index 做完 commit 后，如果不把临时 index 同步回 `.git/index`，下一次任何 session（不管是我还是别的 track）跑 `git status`/`git add` 都会看到诡异的 `MM`/`D`/`??` 混合状态，因为真实 index 还停留在上一个未完成操作的中间态。做法见上面 Git/环境小节。
- **不要无条件信任另一个 session 自己算出来的数字。** 这次巡检 session 报告 life_events=602、monthly_snapshot 12 个月，Cowork 独立查库后发现真实数字是 651 和 16 个月（含 4 个月缺 snapshot）——不是造假，大概率是它在读错文件、上下文比较混乱的情况下算出来的过时/错误对比基准。**每次巡检后，人工看到的汇总数字也要抽查一次，不能连续两层都不验证。**
- **同一个 6 小时定时检查可能被并发触发两次。** 2026-09-06 01:01 UTC 前后，两个 Cowork session 同时在跑这次编排检查：另一个 session 先一步 commit 了 b809d76（只改了 STATE.md 头部时间戳），把「最后更新」写成「00:35 + 6 小时 = 06:35 UTC」——这是算出来的，不是实际查的当前时间，跟真实时间（当时约 01:01 UTC）对不上。连带效应：它 commit 前后产生的 .git/HEAD.lock 在我这边一度被误判成「僵尸锁」（0 字节、ps 里查不到进程），其实是它 commit 那一瞬间的正常残留，只是沙盒不让 git 自己清理。**教训**：锁文件 0 字节不代表一定是死锁，也可能是刚提交完、清理失败；改「最后更新」时间戳一律用 device_bash 里 date -u 的真实输出，不要对旧时间戳做算术；commit 前最好先 git log -3 确认 HEAD 没有在自己不知情的情况下前进过。

**部署验收（2026-09-06 血的教训）**
- **判断「改动有没有上线」要看构建产物，不能看渲染结果。** 今天 B、C、Cowork 三方同时误判：
  页面内容没变 → 都以为"部署没落地"，B 白等 30 分钟、C 写了"production verification blocked"，
  Cowork 还把这个错误结论写进了两个入箱。**真相是部署全部 Ready**，B-17 的代码早就在线上，
  只是那段代码筛出来的数据永远是空数组，所以渲染结果跟没上线一模一样。
  **正确做法**：抓页面引用的 CSS/JS bundle，grep 里面有没有这次改动引入的类名/标识符
  （这次是 `moment-trace`，CSS 里有 = 代码在线上）；或者直接看 Vercel Deployments 的状态。
  **渲染结果为空 ≠ 没部署**——它同样可能是数据或逻辑问题，两者长得一模一样。
- **服务端改动（比如只改数据读取路径）不会改变 CSS/JS hash**，这时只能靠元素计数/内容判断，
  或者看部署列表。另外注意：**不同路由的 CSS bundle hash 本来就不同**，
  拿首页的 hash 跟月页的比是没有意义的（Cowork 今天也犯过这个错）。
- **反复高频请求 nianlife.cn 会触发 bot 防护**（B 轨实测），巡检和预热都要控频。

**验收工具**
- **`v2/scripts/nianlife-status.mjs`（`nianlife-verify` 技能）一键查真实状态**：表计数、月度覆盖、硬盘 vs 库对照、导入任务、质量审阅、线上探活。跑法：`cd v2 && node scripts/nianlife-status.mjs`（需要 `Nianlife`、`WechatHis`、`NianlifeOps` 三个文件夹授权）。每轮开工前和验收时都跑。

**两侧的能力边界**
- Cowork 侧（Claude）：能直接读写仓库文件、跑命令、连生产库、用浏览器看线上站。**硬限制：单条命令 180 秒**。**不能 push**（device_bash 无 SSH key），**但能本地 commit**（用上面的临时 index 技巧，commit 不需要 SSH key，只有 push 需要）。
- Claude Code 侧：能跑几小时的进程，能 push。长任务必须它来跑。
- 同一时间只能有一个 session 对仓库做写操作，三条轨靠文件所有权分区。

**常设规则**
- **每 5 分钟强制汇报**：A 轨写 STATUS.md，B 轨写 STATUS-B.md，C 轨写 STATUS-C.md。**心跳只本地 commit，不每次 push**（决策 18，2026-09-06）。
- **同一个 5 分钟节拍上，先回读自己入箱的顶部看板再写汇报**（`head -60 docs/ORCHESTRATOR-INBOX*.md`）。
  Cowork 每条指令都带 UTC 时间戳，比时间戳就知道有没有新的。**看到新指令先处理指令，再回到原任务**
  ——因为新指令很可能正是在叫你停下（2026-09-06 真实教训：Cowork 02:15 写的更正，B 轨到 03:00
  都没看到，中间白等了 45 分钟部署）。
- **做完任务、入箱没有新任务时，不要就地停住。** 这是今天实测出来的漏洞：5 分钟节拍是绑在
  「正在做任务」上的，一条轨一旦认为自己做完了、空闲了，节拍就停了，于是**再也读不到入箱**——
  2026-09-06 C 轨 C-5 结案后空闲 24 分钟，期间 Cowork 派的 C-6 它完全不知道，只能靠 Teddy 转达。
  **正确做法**：做完写完汇报后，进入**有界等待循环**——每 5 分钟 `head -60` 回读一次自己的入箱，
  最多等 60 分钟；期间有新任务就开工，没有就在出箱写一行「空闲第 N 次回读，无新任务」。
  超过 60 分钟仍无任务再真正收工。**空闲不等于失联。**
- **入箱是唯一的下行通道，而且是被动的。** Cowork 跑在云端，跟 Claude Code 之间没有推送通道
  （实测 peer messaging 够不到 Teddy 电脑上的 session），它只能改仓库文件。所以：
  **你不回读 = 指令永远送不到**。等待、轮询、卡住的时候尤其要回读——那正是 Cowork 最可能在改派你的时候。

## 4. 现在的真实数字（2026-09-06 00:35 UTC，Cowork 独立查库验证，非二手报告）

- raw_sources **46,742** / media_assets **9,077** / life_events **651**（全部 visibility=family）
- life_events 按月覆盖：**2025 全年 12 个月全部 > 0**（01:32 / 02:23 / 03:14 / 04:12 / 05:11 / 06:13 / 07:38 / 08:42 / 09:33 / 10:27 / 11:29 / 12:24，共 298 条）；2026 年 353 条（01-08 每月 29-55 条，09 月 4 条）
- monthly_snapshot：**16 个月**有摘要（2025-01/04/07/08/09/10/11/12 + 2026-01~08）。2025-02/03/05/06 这 4 个月**确认不是缺口**——已发布 life_event 分别只有 4/3/2/1 条，低于 5 条阈值，正常停在 quiet index（A-5 结论，2026-09-06）。
- 夸克入库：214/1,690 非 HEIC 已入；1,468 张 HEIC 阻塞于 P1-2b（Node libheif 解码器限制）。
- 微信原始数据：全部会话已导入（raw_sources 46,742 包含全部 conversation，含最大一个会话的 7,244 条消息）。`nianlife-worker.mjs` 自动化脚本自己的首次正式跑尚未执行。
- 线上：`/` HIT age=26s；`/memory`、`/memory/2026`、`/memory/2026/08`、`/about` 均 STALE（ISR 命中，非首次构建）；`/memory/2026/09` 正常渲染（2 个事件）。手机 375px 与桌面视觉复验均通过，内容无退化。

## 5. P1 任务完成情况（✅ 全部通过）

见历史记录（`docs/STATUS.md`、`docs/STATUS-B.md`、`docs/STATUS-C.md`），P1-0/1/2/2b/3/4/5/6/7/portrait/snap 全部 done，B-1~B-16 全部 done，C-1~C-4 全部 done。

## 6. A-4（2025 全年回填）验收结果（2026-09-05~06）

- **life_events 生成**：✅ 完成，12/12 个月全部 > 0（见第 4 节数字）。
- **误判修复**：2025-10-01 一条把两只家猫的兽医体检报告错判成孩子看兽医（猫也叫"年年"），已确认删除、重新生成 2025-10 快照。全库按宠物/兽医关键词扫描过，只有这一条误判。**根因未修**（`subject-gate.ts` 遇到孤立昵称 + 转发第三方聊天记录的组合仍可能误判），留给下一轮任务。
- **monthly_snapshot 生成**：✅ 已确认完整。2025-02/03/05/06 这 4 个月跑过 `month-review.mjs --commit`
  （A-5，2026-09-06），判官日志一致：已发布 life_event 只有 4/3/2/1 条，低于 5 条阈值，脚本在写库前
  正常退出——`monthly_snapshot` 维持 16 个月不变，这是既有规则生效，不是遗漏。之前认为"有 life_events
  但缺 snapshot"是把总数（含 low 级 not-about-child 行）误当成已发布数来对比，口径错了。

## 7. 后续任务

| 事项 | 状态 | 优先级 |
|---|---|---|
| **补 4 个月 monthly_snapshot**（2025-02/03/05/06） | ✅ 已确认无需补（A-5，2026-09-06：4 个月已发布事件只有 4/3/2/1 条，正常停在 quiet index） | — |
| **A-6 痕迹层数据**（2025 store_only 主体确认） | ✅ 已完成（153 条 trace_eligible，A-10 修复根因后确认可正常读出） | — |
| **B-17 月章节三层排版**（P2 主战场） | ✅ 已结案（2026-09-06，Cowork 手机 375px + 桌面复验通过） | — |
| **C-5 图片交付性能**（B-17 上线前置） | ✅ 已完成 | — |
| **B-18 图片 URL 统一**（unoptimized，解决 C-6 缓存键不一致） | ✅ 已完成（commit 776fa67，Cowork 独立复验 90/90 + 4/4） | — |
| **Vercel Ignored Build Step**（docs-only commit 跳过构建） | 🟡 命令已确认，已告知 Teddy 正确位置（Settings → Build and Deployment，不是 Git），等他粘贴 | 等 Teddy |
| **C-6 图片预热** | ⚪ 放弃（见决策 19：Vercel 边缘缓存 4-5 分钟驱逐，预热前提不成立，改依赖 C-5 冷启动优化） | — |
| **C-6 收尾：测真实冷加载体验**（无预热，真实浏览器，移动端 375px） | 🟢 派给 C | 现在 |
| **A：孤立昵称+第三方转发聊天记录扫描（A-11）** | ✅ 已完成（A 轨 STATUS.md 2026-09-06，在 P0 之前交的） | — |
| **nianlife-worker.mjs 首次正式跑**——手动跑一次 vs 挂 Windows 定时任务 | ⏸ Teddy 说先放着（2026-09-06） | 暂缓 |
| **`INGESTION_TOKEN` 填入 `.env.local`**，打通 worker→revalidate | ✅ 已完成（2026-09-06，Cowork 验证 200） | — |
| subject-gate.ts 收紧「孤立昵称 + 第三方转发聊天记录」判断 | 未开始，需要专门任务 | 中 |
| 夸克 1,468 张 HEIC 转码入库（P1-2b） | 阻塞（解码器限制） | 中 |
| B 轨、C 轨入箱已空 | **可以 /clear**（HANDOFF-B/C 已更新） | — |
| P1-6 真机验收（Teddy 挑一晚跑完首跑 + Cowork 浏览器确认） | 待 worker 首跑决定后 | P2 之后 |
| **P0 egress 事故修复（loadFamilyArchive 误用 getOrganizerStore）** | 🔴 代码已修复+已推上 origin/main（`7d7fe15`），**但部署被 Vercel Ignored Build Step 命令 bug 卡住，线上还是 2 小时前的旧构建，钱可能还在烧**，需要 Teddy 去网页手动改 Settings→Build and Deployment→Ignored Build Step（见第 3 节踩坑记录的更正段） | **现在，需要 Teddy** |
| getEventDetail() 同类无 scope raw_sources 全表读（P0 的衍生尾巴 a） | 未开始，不紧急（详情页流量小），建议比照 getAllEventIdentities() 处理 | 低 |
| 5 个公开页 ISR revalidate 300→3600 的止血提交（commit `cb1d634`） | 同样卡在部署问题上，还没上线，Ignored Build Step 修好、真正的 P0 修复部署确认后再决定要不要回退到 300 | 低（等上面那条解决） |

**阶段 0 的完成标准**：打开 nianlife.cn 任何一个月都能看到张年；首页「最近」是 2026-09；苏静看过一次并说了一句话。

## 8. 工作方式约定

- 任务用 **目标 / 硬边界 / 验收 / 不可接受** 四段式。
- **验收看数据，不看进程状态。**
- **每轮验收必须打开真实网页做视觉验证**，不能只解析 HTML。
- **原则记分卡不是一次性的**：每完成一个里程碑就照 `docs/nianlife-product-principles.md` 重跑一遍。
- **不要连续两层都不验证**：巡检 session 自己报的数字，下一个读到报告的人（不管是 Teddy 还是另一个 Cowork）也要抽查一次，不能一路轻信传下去。
- 每一轮工作结束时，网站上应该多出一样家人能读的东西。
- **每 5 分钟强制写中间进度到出箱**，沉默 = 被判定死亡。心跳只本地 commit，不每次 push（决策 18）。
