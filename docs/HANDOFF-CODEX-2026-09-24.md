# 交接：记忆页打磨 → Codex（2026-09-24 10:05）

交接方：Cowork（Orchestrator）。Claude 额度今天用完了，明天刷新。今天剩下的工作由 Codex 接手，明天再交回。
线上当前版本：4b18075（/api/health 的 build.sha）。main 最新提交：9901e67。

## 一、背景（只读这一节就能开工）
- 项目：nianlife.cn，张年的人生档案。代码在 C:\Users\teddy\Documents\Nianlife\v2（Next.js）。
- 数据库：阿里云 RDS，**只能**通过 v2/.data/night-rds.mjs 的 SSH 隧道访问（openRds / tunnelDatabaseUrl）。.env.local 里**没有** DATABASE_URL，也不要加。
- 月页内容文件：ECS 上的 /srv/nianlife-content/<YYYY-MM>.json。改之前先备份。改完 5 分钟内自动生效，不需要重新部署。
- 部署：v2/scripts/deploy-ecs-public.sh upload/build/swap <SHA>，有两道闸（防旧版本覆盖 + 部署后真实页面冒烟、失败自动回滚）。push 不会触发部署。详见仓库根 CLAUDE.md。只改内容文件的 coverMediaId 时，用 `deploy-ecs-public.sh content-install <月份> <文件>`，不用重新部署代码。
- 模型：本机和 ECS 都已切到智谱 glm-5.3-flash（能看图），Key 在 .env.local 的 ZHIPU_API_KEY。DeepSeek 配置已注释保留。
- 身份表：lib/organizer/family-registry.ts 是唯一依据（爸爸 Ted、妈妈 阿静、奶奶 陈亚萍、外婆 鹿城筱薇、外公 老苏、爷爷 张存华、雪姨 hxx.、各位老师、干妈 多多/Robin）。

## 二、硬规则（违反任何一条都算事故）
1. 禁止 git add -A；只 add 你自己改过的文件。.env.local、.data/ 不提交。凭据不写进输出。
2. **额度/资源纪律**：全程前台执行，不开常驻后台任务，不做自我唤醒或循环。做完确认没有残留进程。
3. 人工编辑过的内容不能覆盖；判断不出来源的，一律当作人工内容。
4. 敏感信息不上页面：裸露/私密画面、证件和单据、带患者信息的医疗单、无关第三方、妈妈本人的病情用药、钱、证件号、精确地址电话、争执。Teddy **不做审阅**：通过校验就直接上线。**2026-09-24 当日补充裁定：孩子国籍办理本身不再作为敏感信息；妈妈病情用药一般规则保留，但 2024-11-05、11-06 两条已有故事继续公开，为明确例外。**
5. 验收必须打开真实网页（手机 390px + 桌面各看一遍，滚到底）。性能以 Teddy 在国内的真机体验为准，海外测速不作为问题依据。
6. 健康页（/health）每次部署后都要确认正常。


## 二·五、部署铁律（防止把已上线的工作回退掉）
线上已经依次上线过多轮改动（07ddc11 孕期页面修复 → 4b18075 封面固定）。**部署错的版本，会把这些全部覆盖掉。**
1. **只从最新的 origin/main 部署**：部署前先 `git fetch`，用 `git log origin/main -1` 确认要部署的 SHA 就是最新提交，而且包含 4b18075（`git merge-base --is-ancestor 4b18075 <SHA>` 必须成功）。不要从旧分支、旧 worktree、本地没推送的提交或 stash 部署。
2. **先 push 再部署**：自己的改动先 commit + push 到 main，再用这个 SHA 部署。
3. **部署前后都要对线上版本**：部署前 `curl -s https://nianlife.cn/api/health` 记下当前的 build.sha；部署后再查一次，确认已经变成新的 SHA，而且新 SHA 是旧 SHA 的后代。
4. **两道闸不许绕过**：必须走 `deploy-ecs-public.sh upload → build → swap`，swap 必须带 HEALTH_MOUNTS。**不要手动 docker run/stop，不要改 swap 脚本来跳过闸门，不要 --force。**闸 a 拦下你，说明你的版本比线上旧，是你错了，不是脚本错了。
5. **ECS 运行配置不要动**：/home/ecs-user/.env.runtime.zhipu 是今天刚切好的智谱配置，部署时继续用它，不要换回旧的 env 文件（否则会退回 DeepSeek）。
6. **只改封面、改内容时不要重新部署代码**：用 `deploy-ecs-public.sh content-install <月份> <文件>`。写入前先备份当前线上的内容文件；只改 coverMediaId 这一个字段，不要用本地的旧文件整份覆盖线上文件（线上内容文件包含第四轮所有重写和媒体）。
7. **部署后必须检查**（手机 + 桌面）：首页、/health（有"年度累计生病"）、/memory（每个月都有封面）、/memory/2026/09（一条时间线、最新在前、首屏一周 + 更多）、/memory/2025/05、/memory/2024/11。发现任何一项倒退，立刻用脚本输出的 ROLLBACK_CONTAINER 回滚，并写进本文件。
8. 一次只有一个会话能部署；Codex 部署期间，不要同时开 Claude Code 去部署。

## 三、已完成（不要重做）
- 排版：月页一条时间线，最新月份倒序，首屏一周 + 「更多」，照片网格 + 「展开」，单日页发言人经注册表解析。
- 数据：私聊_阿静、作战部队、星辰星班、乳儿班去重；导入时按内容去重；媒体补导 405 个；159 个视频封面。
- 内容：2025-01 至 2026-09 共 21 个月，按新规则重写、挂媒体、同场景精选（每个场景最多 3 张，每天最多 12 张）；校验器已上线（说话人与原消息一致、无模糊写法、敏感拦截、机构账号写「老师」）。
- 首页回忆轮播：跨段去重 + 同场景去重（71b88e6）。
- 夜间回填：已改为正式发布（每晚 00:15）。
- 孕期：从 2024-06 开始（04、05 两个月不上页面，Teddy 决定）；11/5、11/6 两条保留（Teddy 决定）。
- 月度封面：4b18075 起，封面固定在内容文件的 coverMediaId，内容变动不会再改动封面。

## 四、今天要做的（按优先级）

### P0 月度封面：替换 9 个不合格的月份，并补上 2025-01
Cowork 已把线上 20 个月的封面拼成联系表逐张看过。合格的有 11 个月：2025-02/03/05/09/10/11，2026-01/03/04/05/07，**这些不要动**。
需要替换的：
- 2025-04：只拍到手握小脚，看不到脸
- 2025-06：妈妈对镜自拍，孩子很小
- 2025-07：画面糊
- 2025-08：动态模糊
- 2025-12：画面主体是爸爸
- 2026-02：在海洋球池里，人太小
- 2026-06：碗挡住半张脸
- 2026-08：低头闭眼、裹着浴巾
- 2026-09：远景，人小，画面里还有别的小孩
- 2025-01：/memory 目录页上没有封面，要补一张
硬性标准（全部满足才能当封面）：张年是唯一或最突出的主体（大人只能露手或身体局部，不露正脸）；脸的高度至少占画面高度的 20%，正脸或 3/4 侧脸，眼睛睁开；清晰、不糊、光线亮；脸没有被遮挡。优先选笑着的、有表情有动作的。
做法：更新 GLM 打分提示词和候选过滤条件；每个月选出前 3 名，**自己打开图片逐张确认**后再写入 coverMediaId；整个月都找不到符合标准的，选最接近的，并在 .data/covers-baseline.json 里注明原因。
验收：重新生成 .data/covers-contact-sheet.html，把 2025-01 到 2026-09 按顺序排成一张，确认每张一眼能看出是张年、前后连起来能看出在长大。然后在 /memory 手机宽度下滚到底，每张卡片都有封面。

### P1 孕期（2024-06 至 2024-12）收尾
- 让 2024-04、05 不出现在年份导航里（线上 04 目前是 404，05 打开是空的）。
- 2024-08 目前能打开但一天内容都没有：查清是没有材料还是没写进去。有材料就补写，没有就从导航里隐藏。
- 每个孕期月份补上月度摘要（和其他月份写法一致，只写原话里有的事）。
- 旧故事里的「苏静说」「Ted 说」统一改成「妈妈说」「爸爸说」。
- 挂上照片：用 .data/r4/prenatal-vision.json 里分类通过的（B 超、孕肚、产检、待产和婴儿用品准备），走敏感校验和同场景精选。
- 修好 prenatal-months.mjs 那 2 天失败的。
- 验收：/memory/2024 和每个孕期月份都滚到底，逐天看。

### P2 收尾
- 更新 docs/STATUS.md，并在本文件末尾追加"Codex 今日完成情况"（做了什么、线上 SHA、没做完的部分和原因）。

## 五、关键文件
- 进度：v2/.data/round4-progress.md、round4-summary.md
- 封面：lib/publication-moments.ts（buildMonthComposition 的 pinnedCoverId）、.data/covers-baseline.json、.data/covers-contact-sheet.html
- 月页入口：app/memory/[year]/[month]/page.tsx；目录页：app/memory/page.tsx、lib/memory-index.ts
- 孕期：.data/r4/prenatal-*.json、.data/r4/prenatal-months.mjs、.data/2024-prenatal-review.md
- 原始需求追踪：Cowork 项目文档 nianlife-memory-polish-tracker.md
