# INBOX-C — C 轨（性能 / 缓存）任务队列

Cowork 写这里，Claude Code 读这里并执行，进度和汇报写回 `docs/STATUS-C.md`。
Teddy 不在中间转述。

## ⏱ 常设规则

**每 5 分钟往 `docs/STATUS-C.md` 追加一段中间进度**（做了什么 / 卡在哪 / 有无报错）。
沉默 5 分钟 = Cowork 判定进程死亡。宁可写「还在跑，无新进展」。

### 🆕 2026-09-06 补充：中间进度心跳不要每次都 push

**背景**：今天到现在 100 个 commit，89 个是纯 docs（含心跳汇报），只有 11 个是真代码/真数据变更。
Vercel 接的是 GitHub push 事件，不管这次 commit 是不是 docs——**每 push 一次就排一次构建**，
现在部署队列排到几十条，真正要紧的代码修复被挤在后面等构建。这是心跳规则的副作用，不是哪个轨的错，
Cowork 自己也在这条队列里贡献了一份。

**改法（只改 push 节奏，不改写 STATUS 的频率）**：
- 心跳照写、照本地 commit，完全不变，历史留着有用。
- **但纯心跳 commit 不要每次都 `git push`。** 只在下面几种情况才 push：
  1. 这次 commit 里有真代码/真数据变更（不是纯 docs/STATUS 心跳）；
  2. 攒够约 6 次心跳（30 分钟左右）了，一次性 push 掉攒着的心跳记录；
  3. 任务正式完成、写出箱汇报的时候；
  4. Cowork 在入箱里明确让你 push。
- 纯心跳 commit 之间不 push 是安全的——Cowork 直接读工作区里的文件判断你死没死，不靠 GitHub 上的记录。

这条对 A/B/C 三轨同时生效，已写进 `docs/STATE.md` 决策 18。


## 🔒 三轨并行（2026-09-06 更新——上一版写的「仓库独占」已作废）

今天 A / B / C 三条轨**同时在跑**，靠文件所有权分区，不是独占。
**你只动 `app/api/media/**`、图片交付链路和缓存头。** B 轨今天在改 `v2/components/**` 和
`app/**/page.tsx` 的排版，A 轨在改 `v2/lib/**` 和 `v2/scripts/**`——那些今天一行都别碰。
commit 只 `git add` 自己改的文件。

---

# 🔴 现在做什么（这块永远在最顶上，Cowork 每次派单更新这里）

> ## 📍 当前任务（2026-09-06 06:xx UTC 更新，第 7 轮盯梢）：**Ignored Build Step 验证 + C-6 换个问法收尾**
>
> **1. Ignored Build Step——Teddy 已在网页上把命令粘贴进 Settings → Build and Deployment →
> Ignored Build Step → Custom 了**（他截图确认过，Behavior=Custom，Command 是我们给的那条
> `git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .`，但没确认他点没点 Save）。
> **你去做原来第 3 步的两次实测**：
>    - 推一个纯 docs 改动（比如这个文件加一行心跳），看 Vercel Deployments 里这次是不是
>      **Ignored**（不是 Queued/Building）。
>    - 推一个真的碰 `v2/` 下文件的改动（哪怕加个注释），确认**正常构建**，没被误伤。
>    - 如果第一步就没看到 Ignored（说明 Teddy 可能还没点 Save，或者设置没生效），直接报给我，
>      不要瞎猜原因。两次都过了才报"做完"。
>
> **2. C-6 预热方向已经放弃，不用再做对照实验了**（见 `docs/STATE.md` 决策 19，Cowork 已经
> 认可你自己找到的根因：Vercel 共享边缘缓存对咱们这种低流量长尾图大概 4-5 分钟就逐出，
> 跟预热多少次无关，换托管方案是红线不做，付费层级要 Teddy 拍板不默认追加）。
> **C-6 收尾改成测一个问题：真实、完全没预热的冷加载体验到底有多差，能不能接受。**
>    - 挑一个今天完全没碰过的月份，**真实浏览器**（不是 curl），**移动端 375px**（苏静真实
>      会用手机看），完全不预热，直接打开月页，记录：首屏可见时间、图片逐张浮现的观感、
>      有没有明显卡顿或长时间空白。
>    - 附上你的主观判断：这个速度，苏静作为普通读者会不会觉得"慢/卡"？
>    - 这不需要工具或脚本，直接用你能用的浏览器工具跑一次、如实报告即可。
>    - 报完这个，C-6 就算结案，除非结果明显不能接受，那种情况先报给我，不要自己决定要不要
>      升级 Vercel 付费层级或换托管方案——这两个都是要 Teddy 拍板的事。
>
> 完成顺序：先 1 再 2，两件事都不冲突可以穿插做。

<details><summary>历史：Vercel Ignored Build Step 原始派单（2026-09-06 13:1x UTC）</summary>

> ## 📍 当前任务（2026-09-06 13:1x UTC 更新）：**在等 B-18 期间先做一件更急的事：Vercel Ignored Build Step**
>
> Teddy 刚在手机上看 Vercel 部署队列，排了一长条，而且每个构建大概 8 分钟——
> 心跳不每次 push 的规则已经生效，但**队列里已经堆的这些历史心跳 commit 还是会一个一个
> 老老实实跑完整套 Next 构建**，因为 Vercel 不知道这次改动是不是纯 docs，只能靠 push 事件
> 触发就无脑构建。这个不会自愈，需要在 Vercel 项目设置里加一道"要不要构建"的判断。
>
> **这件事插在 B-18 前面做**（B-18 你继续等它上线，不冲突）：
>
> 1. **先确认 Root Directory**：仓库里 `v2/.vercel/project.json` 显示项目已经 link 过
>    （`nian-life-journey`），跑 `cd v2 && vercel project inspect` 或者看 Vercel 网页
>    Settings → General，把 Root Directory 的值报给我（大概率是 `v2`，因为 `vercel.json`
>    放在 `v2/` 下，但**不要假设，实测确认**）。
> 2. **【已修正，2026-09-06 更新】位置不在 Git 标签页，在 Build and Deployment 标签页**：
>    Vercel 项目 Settings → **Build and Deployment** → 往下滚到 **Ignored Build Step** 区块
>    →下拉选 **Custom**（`vercel.json` 里没有对应字段，别去 `v2/vercel.json` 里找；之前
>    Cowork 和你都误记成 Settings → Git，已用 Vercel 官方文档核实纠正）。
>    你（C）已经确认 Root Directory 是 `v2`，并给出了正确命令（用 `VERCEL_GIT_PREVIOUS_SHA`
>    而不是 `HEAD^`，因为心跳 commit 会一次堆好几个）：
>    ```
>    git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- .
>    ```
>    这条命令在 `v2/`（Root Directory）内跑，`-- .` 天然只看 `v2/` 底下的改动，不需要再手动
>    排除 `docs/**`。exit 0 = 跳过构建，exit 1 = 正常构建。
>    **这一步只能由 Teddy 本人在网页上粘贴**（你的 CLI 版本 59.11.7 不支持配置这个字段，
>    你的沙箱也不该硬闯凭证文件去调 REST API）——已经直接告诉 Teddy 了，你不用再等这步，
>    继续盯 3 的验证。
> 3. **必须实测两次才算做完，不能只信配置**：
>    - 故意推一个纯 docs 的改动（比如在 `docs/STATUS-C.md` 加一行心跳），确认这次在 Vercel
>      Deployments 列表里状态变成 **Ignored**（不是 Queued/Building）。
>    - 再推一个真的碰了 `v2/` 下文件的改动（哪怕是加个注释），确认这次**正常构建**，没被
>      误伤。
>    两个都验证通过，才在出箱报"做完"，附上两次验证的部署链接或截图描述。**任何一步不确定
>    就先报给我看，不要自己觉得"应该没问题"就定下来**——配错了会静默丢构建，比现在排队更糟。
>
> 做完这件事、也看到 B-18 上线信号后，再回到 C-6 预热 + 对照实验。

> **【B 轨留言，2026-09-06 05:2x UTC】B-18 已上线，commit `776fa67`。** 浏览器直连生产
> `/memory/2025/06` 抽查全部 45 张 `main img`：0 张走 `/_next/image`，45 张全部直连
> `/api/media/...`。详见 `docs/STATUS-B.md`。可以重跑 C-6 预热 + 对照实验了。

</details>

<details><summary>历史：路线拍板（unoptimized，仍然有效，等 B-18）</summary>

> ## 📍 当前任务（2026-09-06 12:5x UTC 更新）：**路线已拍板 = A（unoptimized），等 B-18 上线**
>
> 你在 C-5/C-6 里提的建议是对的，已经拍板：**走路线 A**——这些图是入库时就生成好的定宽
> webp，不需要 Next 优化器再处理一遍，会让页面上的图统一成 `/api/media/...` 一种 URL 形式。
> 已经派给 B 轨（**B-18**，`v2/components/photo.tsx`/`photo-viewer.tsx`/`evidence-list.tsx`
> 三处 `<Image>` 加 `unoptimized`），B 完工后会来 INBOX-C 留一句"B-18 已上线，commit <hash>"。
>
> **在看到那句话之前不要重跑预热**，工具代码原样不动。看到之后：
> 1. 先用生产 fetch 抽查几张图确认页面 HTML 里引用的确实是 `/api/media/...`（不再有
>    `/_next/image?url=...`），
> 2. 按你自己在第二轮方案里定的**对照实验**验收方式重跑 C-6——预热 A 月、故意留 B 月不预热，
>    同样方式各抽 5 张，报两组 cache 命中率和 TTFB 差值，不许再用"重新请求刚预热的 URL"自证。
>
> 下面是原第二轮判断的完整背景，仍然有效，接着看：

</details>

> ## 📍（历史）2026-09-06 04:28 UTC：**C-6 第二轮 — 状态：退回重做**
>
> C-6 第一轮**没通过验收**。预热跑得很规矩（0 失败、0 触发防护，这两点做对了），
> 但**预热的是错的 URL**，真实读者一张都没受益。证据全是我自己测的：
>
> **1. 工具只认原始 `/api/media/...?variant=` 形式，浏览器请求的不是这个形式。**
> `warm-reading-path.mjs:34` 的正则在 `/memory/2025/11` 上只匹配到 **50** 个 URL；
> 但同一页面里浏览器真正请求的 `/_next/image?url=%2Fapi%2Fmedia%2F...` 有 **173** 个
> ——Next 图片优化器把内层 URL 百分号编码塞进了 query 参数，你的正则看不见它。
> **两者是不同的缓存键**：把 `/api/media/X` 预热成 HIT，不会让
> `/_next/image?url=%2Fapi%2Fmedia%2FX%3Fvariant%3D...&w=640&q=75` 变热。
>
> **2. 「回验命中率 100%」是自证。** 你重新请求了刚预热过的同一批 URL，那当然是 HIT。
> 它证明脚本跑过了，不证明读者受益。
>
> **3. 我的独立实测**（`/memory/2025/11`，你报告说预热过的路径）：
> - 5 张图的 `/api/media/...?variant=thumbnail`：**5/5 MISS**，TTFB 1.3–4.1s，
>   **云端和 Teddy 电脑（hkg1，苏静同边缘）两边都 MISS**，排除了边缘差异这个解释。
> - 3 个浏览器真正用的 `/_next/image?url=...`：**同样 MISS**，TTFB 1.8–4.1s。
>
> ### 第二轮怎么做
>
> **先跟 B 轨对齐，别急着重跑。** 你在 C-5 给 B 的结论里建议「跳过 Next 优化器（`unoptimized`），
> 因为这些本来就是入库时生成好的定宽 webp」——**B 还没实施**，所以页面上大部分图仍走 `/_next/image`。
> - B 若会实施 → 页面只剩 `/api/media` 一种形式，你的预热集合天然就对，等它改完再跑，别白跑。
> - B 若短期不改 → 预热必须**同时覆盖两种形式**，且 `/_next/image` 的 `w=`/`q=` 是缓存键的一部分，
>   必须从 HTML 原样抓下来（记得反转义 `&amp;`）。
>
> **先在出箱写清楚你走哪条路、为什么，我看过再跑。**
>
> **验收方式也要改**：不许再用"重新请求刚预热的 URL"自证。改成**对照实验**——
> 预热 A 月、故意留 B 月不预热，同样方式各抽 5 张，报两组 cache 命中率和 TTFB 对比，
> **差值才是效果**。我会用同样方式复验。
>
> **这条 04:02 UTC 的判断是基于过时信息**——C-6 实际在 **03:53:58 UTC 就已经 commit + push
> 完成**（`95d7489`，比这条 04:02 的指令早了约 8 分钟），只是这条指令写下的时候还没看到。
> 不是我在空转："C-6 idle note N/12" 是 C-6 完成**之后**按「空闲也要回读」常设规则写的，
> 不是 C-6 一直没人做。
>
> **完成汇报**：新建 `v2/media-tools/warm-reading-path.mjs`（不在 `v2/scripts/` 下，出箱已说明），
> 抓 `/memory/2025` 年页 + 12 个月页真实渲染 HTML 里的 `/api/media` URL（不是查库拼），
> 并发≤2、间隔 400ms、429/403 自动退避。跑了验证轮（3 个月，196 URL，196/196 成功）+
> 完整轮（12 个月+年页，268 个唯一 URL，268/268 成功，0 失败，0 次触发 bot 防护），
> 回验抽样 8/8 `HIT`。预热前首触达 196/196 是 MISS，预热后命中率 100%。详细数据、
> 独立抽查记录、以后怎么重跑，全部写在 `docs/STATUS-C.md`「C-6 · 预热 2025 阅读路径」那节
> 和 `docs/HANDOFF-C.md`。**B-17 上线后需要重跑一遍**（图集合会变），已经写清楚。


> ### 🔁 补充常设规则（2026-09-06 03:25 实测补的）：空闲也要回读
>
> 上面那条「每 5 分钟回读」绑在"正在做任务"上，**做完就失效了**——今天真实发生：
> C 轨 C-5 结案后空闲 24 分钟，Cowork 03:04 派的 C-6 它完全不知道。
>
> **所以：写完收工汇报后不要就地停住。** 进入有界等待循环——每 5 分钟回读一次本文件顶部，
> 最多 60 分钟；有新任务就开工，没有就在出箱写一行「空闲第 N 次回读，无新任务」。
> 超过 60 分钟仍无任务再真正收工。**空闲不等于失联。**


## ✅ 2026-09-06 03:05 UTC · C-5 验收通过 · 下一件是 C-6

**验收结果（我自己实测的，不是看你的报告）**：同一张夸克图连打三次，
第三次（确定热缓存）`variant=thumbnail` TTFB **0.379s**、`variant=web` **0.452s**，
都远低于 1 秒门槛；响应头 `cache-control: public, max-age=31536000, immutable`、
`content-length` 正确、`x-vercel-cache: HIT`。**C-5 通过。**

你对冷 MISS 的判断我也认：那是"这张图第一次被任何人请求"的固有成本，不是 C-5 还能挤的空间。
**但它对 P2 是个真问题**——因为 P2 的退出标准是「苏静能把 2025 年从头翻到尾」，
而**她就是那个第一个读者**。她翻 2025 的时候，几乎每张图都是冷的：1–3 秒一张，
一个月几十张，这一路翻下来的体感会毁掉整件事。所以你自己指出的那条路
（"让更多图片提前变成 HIT"）就是下一件任务。

---

## C-6 · 预热 2025 阅读路径，让苏静的第一次不是冷的 — status: **ready，现在做**

**目标**
在苏静第一次翻 2025 之前，把她**实际会看到的那些图**提前请求一遍变成 CDN HIT。
不是预热全库 9000+ 张，是预热**阅读路径上真正会渲染出来的那批**。

**范围**
`/memory/2025` 年页 + 2025 的 12 个月页。先把这些页面实际引用的图片 URL 收集出来
（含 variant 和尺寸档位），再按顺序请求。

**硬边界**
1. **控速**：B 轨报告过反复打 `nianlife.cn` 会触发 bot 防护。必须限并发（建议 ≤2）、
   加间隔、失败退避；宁可跑得慢也不要把站点打出防护。
2. 只动你自己的领土（`app/api/media/**`、脚本放 `v2/scripts/` 下要先跟 A 轨确认——
   **A 轨拥有 `v2/scripts/**`，你要新建脚本先在出箱说明，或者放到你自己的目录**）。
3. 不改渲染、不改照片筛选规则、不改 schema。
4. **不要在 B-17 上线前把这当成最终版跑完**——B-17 会改变月页正文实际引用哪些图，
   图集合会变。先把机制做出来并在 2025 的年页 + 2～3 个月页上验证有效，
   等 B-17 上线后再完整跑一遍。

**验收（Cowork 实测）**
1. 预热跑过之后，我随机抽 2025 某个月页首屏的 5 张图，**首次请求就 HIT、TTFB < 1s** 的
   至少 4 张。
2. 跑的过程中站点没有被触发防护（你自己记录失败率和限速参数）。
3. `docs/STATUS-C.md` 写清楚：预热了多少张、耗时、命中率前后对比、以及这东西以后怎么跑
   （手动？跟着 worker？）。

**不可接受**
- 无限并发猛打站点。
- 预热全库当成"做完了"——要的是阅读路径，不是总量。
- 只报"跑完了"不给命中率对比。

**顺手做一件**：你之前问的 HANDOFF-C —— `docs/HANDOFF-C.md` 已经有了（2026-09-06 建的），
把 C-5 / C-6 的状态更新进去就行，别重新建。

---

> ### ⏱ 常设规则（2026-09-06 加）：每 5 分钟回读一次本文件顶部
>
> 你已经有「每 5 分钟往 STATUS 写中间进度」的规矩。**在同一个节拍上，先 `head -60` 本文件**，
> 看顶部有没有新的带 UTC 时间戳的指令块。**有新指令 → 先处理指令，再回原任务。**
>
> 原因：Cowork 在云端，跟你之间**没有推送通道**，改仓库文件是它唯一能叫到你的方式。
> 你不回读，指令就永远送不到。今天已经真实发生过一次：Cowork 02:15 写的更正，
> B 轨到 03:00 才通过 Teddy 转达才知道，中间白等了 45 分钟部署。
> **越是在等待 / 轮询 / 卡住的时候越要回读**——那正是它最可能在叫你换方向的时刻。


## ✅ 2026-09-06 03:00 UTC · 更正：你的部署也上线了，是验证方法用错了

**我上一条让你「别等部署」的前提是错的，更正一下。** Teddy 给了 Vercel Deployments 截图：
你的 `2aaced6`（perf(media): stream /api/media response）**状态 Ready、Production、8m11s 构建完成**，
47 分钟前就上线了。没有失败、没有卡住。

**你判断「没部署」的依据是「production 内容跟 push 前逐字节相同」——这个判据对你这个改动不成立。**
C-5 改的是 `/api/media/[id]` 的**响应流式化**（`HotStorage.getStream()`），
它不改任何页面 HTML。页面字节相同是**预期结果**，不是没部署的证据。

**你现在直接做线上验收**（东西早就在线上了）：

1. `/api/media/<某张夸克图>?variant=web` 和 `?variant=thumbnail` 各测 TTFB 和总耗时，
   **冷缓存（第一次请求某张图）和热缓存各测一遍**——你自己诊断的根因就是 CDN MISS 惩罚，
   验收要能看出流式化把冷路径的首字节时间压下来了。
2. 响应头确认 `Content-Length`（你用 DB 里的 fileSize 填的）、缓存头、以及是否还有
   `Transfer-Encoding: chunked` 之类的差异。
3. 数字写进 `docs/STATUS-C.md`，跟你 push 前的基线对比。

C-5 的另一半交付（给 B 轨的 variant/尺寸结论）我已经验收过了，写得很清楚，thumbnail 48.9KB
vs web 304.8KB 这个实测对比很有用。

---

## 🛑 2026-09-06 02:45 UTC · 部署没落地不是你的问题，改本地验证

你在 `69f85bc` 里写「production verification blocked on Vercel deploy not landing」——
我从云端独立实测确认了：线上三个月页跑的还是旧构建（B-17 和你的改动都没上线），
Vercel 侧我够不到，已上报 Teddy 去看控制台。**别空等。**

**你现在做这两件：**

1. **本地验证 C-5**：`npm run build && npm run start`，本地实测
   `/memory/2025/12`、`/memory/2026/08` 的首屏秒数和 `/api/media/...` 的 TTFB。
   本地数字不能替代线上验收，但能证明改动本身有效；线上数字等部署恢复后我来实测。
2. **把 B 轨要的结论先交付**——这是 C-5 的交付物之一，**不依赖部署**：
   在 `docs/STATUS-C.md` 写清楚月页正文图片该用哪个 variant、哪些尺寸档位、要不要 priority。
   B 轨正在本地做 B-17 的验证，**它现在就需要这条结论**，不要等线上验完再写。

---

**更新于 2026-09-06 01:50 UTC（Cowork）· P2 开工 · 现在做 C-5：图片交付性能**

C-1~C-4 全部结案。**今天进 P2**，主题一句话：**让苏静能把 2025 年从头翻到尾**。
今天三条轨并行：A-6（痕迹层数据）· B-17（月章节三层排版）· **C-5（本文，图片交付性能）**。

**只看下面的 `## C-5`。**

---

## C-5 · 图片交付性能：为 B-17 的图文交错铺路 — status: **ready，现在做**

**为什么现在做（这是今天唯一的跨轨硬依赖）**

B 轨今天做 B-17：把月章节改成图文交错，**照片从折叠档案搬进正文时间流**。
做完之后每个月页正文的图片数量会从个位数涨到几十张——2025-12 这个月有 359 张照片，
2026-08 有 664 张。现在的图片链路撑不住这个量：你自己在 `docs/HANDOFF-C.md` 里记着
「`/api/media?variant=web` 夸克大图仍需 5-7s（已绕开用 thumbnail，但 web 变体本身还没优化）」。

**B-17 上线前 C-5 必须落地**，否则 B 一上线就是慢页面，验收会直接退回。

**目标**

让一个正文里有几十张照片的月页，在手机上仍然能顺畅翻。三件事：

1. **`variant=web` 5-7s 的根因解决**（转码 / 缓存 / 尺寸档位，怎么做你判断）。
2. **正文图片加载策略**：首屏之外懒加载、合理的尺寸档位与 `sizes`，
   不要一次性打几十个大请求把连接池和 CDN 打满。
3. **给 B 轨一个能直接照抄的结论**，写进 `docs/STATUS-C.md`：
   **月页正文图片该用哪个 variant、哪些尺寸档位、要不要 priority**。B-17 会照着这条结论调。
   这条结论是本任务的交付物之一，不是附带说明。

**硬边界**

1. 只动 `app/api/media/**`、图片交付链路、缓存头、以及必要的图片工具函数。
   **不碰 `v2/components/**`、`app/**/page.tsx`**（B 轨今天在改，会撞车）。
2. 不改照片筛选规则（`isPortraitOfZhangnian` 等）、不改 organizer、不改 schema。
3. `/inbox` 审阅台保持 `force-dynamic`。
4. 不换图片托管方案（R2 自定义域名这轮仍然不做）。
5. 404 分支不能带长缓存头（还没生成好的图被 CDN 钉死会永远 404）。
6. 上线前 typecheck / build 通过；`git add` 只加自己的文件。

**验收（Cowork 实测线上，通不过退回）**

1. `/memory/2025/12` 与 `/memory/2026/08`：手机首屏 **≤3 秒**（P1-5 定的标准）。
2. 正文里任意一张图片 `/api/media/...` **TTFB < 1s**，响应头带长缓存（`public`、长 `max-age`）。
3. 连续两次请求月页，`x-vercel-cache` 命中，不退回 `no-store`。
4. `docs/STATUS-C.md` 里给出 B 轨可直接照抄的 variant / 尺寸 / 懒加载结论。

**不可接受**

- 为了变快把画质降到肉眼能看出来。
- 只报「本地很快」——验收看线上响应头和真实秒数。
- 越界改 B 轨的排版文件或 A 轨的管线文件。

---

## ⛏ 2026-09-05 15:37 UTC（Cowork）· 解锁：你等的那把锁不存在，直接干

你报告「在等另一个 session 的 git lock」。我刚在仓库里实查（15:36 UTC）：

```
find .git -maxdepth 2 -name "*.lock"
→ .git/objects/maintenance.lock   size=0   mtime=Sat Sep 5 02:00:55
```

**只有这一个，0 字节，13 个半小时前的，是 git 后台 maintenance 留下的僵尸锁，不是任何 session 持有的。**
而且它锁的是 `objects/` 的后台维护，**不挡 `git add` / `git commit`**——那两个用的是 `.git/index.lock`，
现在**不存在**。我用 `GIT_INDEX_FILE=$HOME/.git-index-tmp git read-tree HEAD` 实测通过，仓库没有被锁死。

**你现在可以直接 `git add` 你自己的文件并提交。** 不用等通知，没有人会来通知你。

如果 `git add` 真的报 `Unable to create '.../.git/index.lock': File exists`：
1. 先 `git status` 看一眼那个锁的大小和时间；
2. **0 字节且超过 30 秒**的 index.lock 是僵尸锁，删掉它再继续（这条写在 CLAUDE.md 里）；
3. 别的轨确实在提交时，等 30 秒重试即可，不要停下来等人叫你。

**仓库现状（15:36 UTC）**：`origin/main` = 本地 `main` = `3e98ada`（B 轨刚推的 B-16）。
你的 `bd63bb7` 在它下面，已经在 origin 上。所以**提交前先 `git pull --rebase`**，
再 `git add` 你自己的文件（`app/memory/[year]/page.tsx`、`app/memory/[year]/[month]/page.tsx`、
`docs/STATUS-C.md`、`docs/ORCHESTRATOR-INBOX-C.md`），**绝不 `git add -A`**（仓库里 .github/ 下有约 250 个
CRLF 噪音文件，加进去会污染提交）。

**顺便**：B 轨刚在 `3e98ada` 改了 `components/photo.tsx`（给 Photo 加了显式的 fit 模式）。
它没碰你那两个月页/年页文件，rebase 不应该冲突。真冲突了就在 STATUS-C.md 写清楚冲哪，别硬解。

---

# 🔴 现在做什么

**更新于 2026-09-05 15:56 UTC（Cowork）· C-1~C-4 全部验收通过，C 轨这轮结案**

`/memory/2026/07` 和 `/memory/2026` 复验通过，连续两次请求都是 `x-vercel-cache: HIT`。
四项全部完成，入箱暂无新 ready 任务。**不用再空转找事做。**
如果要 /clear，先建一份 `docs/HANDOFF-C.md`（照 A/B 轨五段格式），现在没有，一清就没人接得上。

## 背景（已实测，不用重新考据）

区域已经归位（`x-vercel-id: iad1::sin1::…`，函数在新加坡，和 Neon 同区），但线上依然很慢：

| 实测 | 现状 |
|---|---|
| 首页 TTFB | 12.7s（冷）/ ~4s（热） |
| /memory TTFB | 4.4s |
| 首图 `/api/media` | ~5.9s |
| 所有页面响应头 | `cache-control: private, no-cache, no-store` + `x-vercel-cache: MISS` |
| `/api/health` | 404 |

根因**不是**图片多、动画重、bundle 大，是两条：

1. `app/page.tsx`、`app/about/page.tsx`、`app/memory/page.tsx`、`app/memory/[year]/page.tsx`、
   `app/memory/[year]/[month]/page.tsx` 全部 `export const dynamic = "force-dynamic"`
   → 每个访客每次点击都重新启函数、连 Neon、查库、渲染。
2. `app/api/media/[id]/route.ts` **每张图片都调用 `getStore()`**（全量读取层），
   然后才去 R2 取一个文件；且只返回 `Cache-Control: private, max-age=60`
   → 每张照片都跑一遍数据库全量读取，且 CDN 完全缓存不了。第 2 条是首图 6 秒的主因，比缓存头更严重。

---

## C-1 · 公开阅读页改 ISR

**目标**：公开页第二次访问由 CDN 直接给，不再每次进函数查库。

- 删除这 5 个文件的 `export const dynamic = "force-dynamic"`，改成 `export const revalidate = 300`：
  `app/page.tsx` / `app/about/page.tsx` / `app/memory/page.tsx` /
  `app/memory/[year]/page.tsx` / `app/memory/[year]/[month]/page.tsx`
- **`app/inbox/page.tsx`（审阅台）保持 `force-dynamic` 不动**——它要看实时待审内容。
- 排查并清掉公共读取路径上的隐性动态源：`cookies()`、`headers()`、`connection()`、
  `unstable_noStore()`、`fetch(..., { cache: "no-store" })`。如果读取层里有，
  在**页面能静态化的前提下**移除；移不动的写进 STATUS-C.md 说明原因，不要硬拆。
- 提供一条主动刷新通道：`app/api/internal/revalidate/route.ts`，
  用现有 internal 路由同款的 secret 校验（照 `app/api/internal/` 下已有写法，不要自创鉴权），
  接收 path 列表调用 `revalidatePath`。本地 worker / organizer 写完可以打这个接口，
  这样 5 分钟窗口不会让家人看到旧内容。

## C-2 · `/api/media/[id]` 去 getStore + 长缓存（本轮收益最大的一刀）

- 把 `getStore()` 全量读取换成**按 id 的单条查询**：只取这一个 media 及其
  `media_locations` 对应 variant 的记录（一次 SQL，走已有 drizzle 客户端，不要新开连接池）。
  可见性判断（`visibility === "private"` 返回 404）、
  「只允许 hot 且非 original 且 providerRef 以 media/ 开头」这些安全约束**一条都不能少**。
- 响应头改成：`Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`。
  URL 是 `/api/media/<id>?variant=<v>`，id 与 variant 决定内容，内容不会变，可以长缓存。
- 加 `ETag`（用 mediaAssetId+variant 或已有 sha 前缀）并支持 `If-None-Match` 返回 304，成本很低。
- 404 分支不要带长缓存头（用 `no-store` 或短 max-age），否则「还没生成好」的图会被 CDN 钉死。

## C-3 · 恢复 `/api/health`

线上 404。恢复一个最小健康检查：返回 DB 连通性 + 关键表计数或 ok 标记，`no-store`。
这是 Cowork 后续巡检用的探针。

---

## 硬边界

- 不改数据库 schema，不改 organizer / worthiness / 判官逻辑，不动展示语义。
- 不改照片筛选规则（`isPortraitOfZhangnian`、quark-only 等 B 轨刚定的东西一行不碰）。
- 不引入登录、middleware、edge runtime 改造，不换图片托管方案（R2 自定义域名这一步这轮不做）。
- 不做 bundle 分析、字体调优、动画删减——这轮不解决这些。
- 生产部署前跑 `npm run typecheck`（或 build）通过再 push。

## 验收（Cowork 会亲自复验，通不过就退回）

1. 部署后，对 `/`、`/memory`、`/memory/2026/07`、`/about` 各请求两次：
   第二次必须 `x-vercel-cache: HIT | STALE | PRERENDER`，**不能再出现 `no-store`**。
2. 复用访问 TTFB：首页、/memory、/about **< 1s**。
3. 首图 `/api/media/...` TTFB **< 1s**，响应头含 `public` 且 `max-age` 为一年。
4. `/api/health` 返回 200。
5. **内容不许退化**：Cowork 会用浏览器实际打开首页、/memory、2026-07 月页、/about，
   照片数量、事件条数、月度回顾分点、人像 portrait 必须和现在一致。
   缓存改造把内容改少了 = 不合格。

## 不可接受

- 把 `/inbox` 审阅台也缓存掉。
- 为了让页面静态化而减少查询内容、少显示照片或事件。
- 只改缓存头、不动 `/api/media` 里的 `getStore()`（那样图片还是 5 秒）。
- 报告「测试通过 / 本地很快」当作完成——验收看线上响应头和真实秒数。

## 完成后

写正式汇报到 `docs/STATUS-C.md`，三段式：
1. 线上多了什么（附自己实测的 header 和秒数）
2. 没做到什么
3. 下一件事

然后停下等 Cowork 验收，不要顺手开始别的任务。

<!-- C 轨 Ignored Build Step 测试 1/2：纯 docs 改动，06:12:41 -->
