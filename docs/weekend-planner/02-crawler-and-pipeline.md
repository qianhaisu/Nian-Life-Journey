# Nianlife「周末去哪」爬虫架构与全链路工程设计书（02-crawler-and-pipeline）

> **模块定位**：Nianlife「周末去哪」行前决策层的**两阶段小红书采集、事实验证、6 条硬淘汰、最晚出发时限推导、打分组合与自动化周更发布流水线**。  
> **上游对齐**：产品定义见 [01-product.md](./01-product.md)；第三轮重选实测与数据包见 [examples/2026-11-21.json](./examples/2026-11-21.json)、[examples/2026-11-21.md](./examples/2026-11-21.md)、[examples/xhs-crawl-manifest-2026-11-21.json](./examples/xhs-crawl-manifest-2026-11-21.json) 与 [examples/xhs-crawl-manifest-2026-11-21.md](./examples/xhs-crawl-manifest-2026-11-21.md)；项目基线见 [AGENTS.md](../../AGENTS.md) 与 [docs/daily-editor.md](../daily-editor.md)。  
> **核心工程铁律**：**没有近 30 天真实小红书笔记依据且达到互动门槛就不推荐（抓不到则硬熔断停发，显示「本周推荐暂未更新」）；第一阶段必须无地名开放发现、排除家庭不喜欢类型关键词、第二阶段再做地名验证；遇验证码/滑块立刻停止并报告 Teddy；零无来源价格区间；前端请求零实时爬取；提案与真实旅行足迹写隔离**。

---

## 一、5.2 节：信息来源矩阵与硬准入规则

系统采用「**近 30 天小红书实拍硬准入 + 官网具体详情页交叉核验 + 携程登录态实时查价 + 国内可达逐 3 小时天气 + 历史道路规律**」的多源漏斗架构。与旧版不同，**本轮彻底废除「小红书抓不到时降级用官网内容强行凑推荐」的逻辑**。

### 1.1 八类信息源分工、准入铁律与两轮实测对照

| 序号 | 信息源 | 角色定位与硬门槛 | 检索与抽取规则 | 两轮真实实测表现（2026-11-16） |
|---|---|---|---|---|
| **1** | **小红书（Web 端）** | **两阶段采集 + 互动门槛硬主源** | **准入硬门槛**：<br>· 每个推荐方案核心锚点须有 **`>= 2` 篇近 30 天真实小红书笔记**及带 `xsec_token` 直跳 URL；<br>· **互动门槛**：每方案依据笔记里至少 `1` 篇满足 **`点赞 >= 100` 或 `评论 >= 10`**；若仅低互动笔记支撑必须标为 **`「信号较弱」`**，不得冒充强推；灵感库每条至少 `1` 篇近 30 天笔记。<br>**两阶段关键词策略（第三轮重改）**：<br>① **第一阶段（开放发现，禁具体地名）**：生成前先拉取「我们不想要的类型（如 `美术馆/艺术展`）」黑名单，关键词**禁现任何景区/地标地名，且明确排除「看展 / 美术馆 / 艺术」**（如 `上海 周末 草坪 人少`、`杭州周边 开车直达 风景 不用爬`、`江浙沪 周末 带娃 放空`、`杭州周边 农场 采摘 不挤`、`上海周边 水边 住一晚`）；<br>② **第二阶段（候选地名验证）**：从第一阶段高赞/高贴合笔记及高互动存量候选中，挑选优胜去处跑具体地名验证词核实推车、停车、人流与近期实况。<br>**热度 ≠ 人少**：对高赞笔记必须通读评论区辨别周末挤不挤、是否滤镜旧图/季节未到（见 §1.3 实测复盘）。**不下载/直链小红书图片到 Nianlife 前端**。 | · **第一轮无登录**：`0/6`。<br>· **第二轮（偏差已复盘）**：10 词里 5 个预先绑死旧地名、2 个直接搜西岸看展，忽略 `#01` 森兰绿地 1369 赞等高赞发现，仅凭 15/43 赞低互动笔记推了西岸美术馆。<br>· **第三轮重选补抓**：执行「先开放发现、再地名验证」，发现并核实多条高互动非艺术自然/草坪/农事/湖畔笔记（`森兰绿地`、`萧山山末址村 1042 赞/442 评`、`余杭贝莱特庄园 149 赞`、`嘉兴神仙湖 116 赞` 等），全程串行 8.5–16 秒间隔，0 验证码。 |
| **2** | **大众点评 / 美团榜单与新店** | **新店 / 咖啡烘焙 / 营业实态补充** | 仅用于核对已选锚点 15 分钟顺路范围内的独立咖啡/面包/安静餐厅营业实态及近 14 天差评异味信号；低频只读，禁止以纯餐饮为主锚点。 | 受限于平台登录墙与反爬策略，Phase 2 在同一已登录环境按需低频补充；不得在未实查时编造门店仍在营或排队时长。 |
| **3** | **公众号搜索（搜狗微信 / 官方推文）** | **权威闭馆与预约规则核验** | 检索目标场馆/景区官方推文：临时闭馆维护、预约小程序入口变更、免费导览名额。 | 通过具体推文详情页核验（如 `lzmuseum.cn` 2026-11-11 芦苇最佳期与 11-09 停用文旅壹卡通预约公告）；凡未直见官方闭馆原文的传闻（如浦东美术馆官网日历仅示 19M 于 11.15 结束），如实标 `unconfirmed`（「待确认」）。 |
| **4** | **城市文旅 / 场馆官方详情页** | **硬事实锚点真值源（详情页清洗铁律）** | 提取展期、开放时段、闭馆日、停止入场时刻（用于算 `latestDepartureCutoff`）、儿童免票线与地下车库入口；SPA 站点使用 Playwright 渲染 DOM。<br>**详情页清洗规则**：标为 `verified`（前端显示「已确认」）的每条链接**必须直指具体文章/展讯/票务详情页**；凡只链向根域名首页（如 `hangzhou.gov.cn/`、`shanghai.gov.cn/`）一律替换为具体详情页或降为 `unconfirmed`。 | 实测 `wbmshanghai.com/zh-hans/exhibition/1615-event-computer-worlds`、`/zh-hans/page/visit`、`/zh-hans/page/Ticket%20Purchase%20Information`、`westbund.com` 定位页、`xzhfjq.com/line/list.html`、`hz.bendibao.com/tour/2025911/ly166517.shtm`、`hznews.hangzhou.com.cn/.../content_9371791.htm` 等具体详情页均实测可达并保留。 |
| **5** | **大麦 / 秀动票务** | **室内备胎与余票热度信号** | 周一/周二只读查询杭州/上海小型室内演出与展览，提取开演时段与余票档位辅助评估拥挤度与雨天备选（不自动下单）。 | Phase 2 纳入常规只读检查。 |
| **6** | **官方 / OTA 酒店核验源（携程登录态）** | **周六过夜实价与退改硬门槛** | **固定口径**：周六入住、周日退房、1 间房、`2 成人 + 1 名幼儿`（`ages=1`，年龄由 `ageOn` 动态计算；`1.8m+` 大床同睡，**无需婴儿床，不把婴儿床作筛选/风险提示/阻塞项**）。**偏爱亚朵标准化大床房（不喜欢喜来登、亚朵优先，不把其他五星品牌一概排除，不以成人泳池作为高优先级门槛）**。每个报价绑定具体大床房型与床宽、含税总价、早餐份数、完整北京时间取消截止、停车费率、`bookingUrl` 与各自 `capturedAt`。<br>**价格铁律**：**查到即写实价，查不到写明原因并标 `unconfirmed`（「待确认」），彻底删除所有无来源的历史参考价格区间**；凡含早实价 `> 1000 元/晚` 或售罄立即淘汰。 | **实测结果（`2026-11-21 ~ 11-22`）**：使用已扫码 `browser-profile/` 实查浦东森兰/金桥与静安/巨富长共 10+ 家候选：<br>· **上海浦东金桥地铁站亚朵酒店（浦东首选）**：2023 年开业，高级大床（26㎡ · 1.8m）2 早 **`¥560`**（1 早 `¥488` / 无早 `¥464`），当日 12:00 前取消，免费停车，步行 820m 到 LaLaport；<br>· **上海浦东金桥国际商业广场亚朵酒店（沿线对比）**：标准 2 早 `¥490` / 高级 2 早 `¥543`（2018 年开业，近杨浦大桥，免费停车，1.2m 以下儿童早 ¥24）；<br>· **静安周边**：静安寺华山路亚朵X 1.51m 雅致 2 早 `¥851`、1.8m 行政 2 早 `¥1,040`（超上限）；静安假日 2 早 `¥845`；铂尔曼 2 早 `¥1,056`、昆仑 2 早 `¥1,210`、洲际 2 早 `¥1,101` 均超 ¥1,000 硬上限。*(注：第五轮曾核查外高桥喜来登 ¥731，后续按家庭偏好已改回亚朵为主推。)* |
| **7** | **高德 / 百度地图源** | **静态车程估计与 15 分钟闭环校核** | 从三墩原点（`30.27, 120.15`）测算单程距离与常规耗时（含小红书周六出城实测修正）；校核本地 `<=45m`、1 小时圈 `<=1.5h`、跨城过夜 `<=2.5h` 与 15 分钟串联。 | 绝不用周二/周三实时路况预测周六堵车；结合历史周末规律与小红书笔记（如 `#07` 实测周六 09:00 后杭州西出城常走近 2.5h）标为 `estimated`（「预估」）。 |
| **8** | **国内可达逐 3 小时天气源** | **按活动时段精细匹配天气** | 解析 `weather.com.cn/weather/<cityCode>.shtml` 内嵌 **`var hour3data`** 的 7 日逐 3 小时时段数据（`08/11/14/17/20/23/02/05时`），按方案实际活动窗口生成 `weatherSlots[]`，并强制校验 HTML `<title>` 城市名防站号写错。 | **两轮及第三轮实测结论**：<br>① `api.open-meteo.com` 本机超时失败（`5014 ms`），**禁止使用**；<br>② 第三轮核查 `<title>` 发现旧版德清代码误填为 `101210202`（实际是长兴），**已更正为德清真实站号 `101210204`**，并补齐杭州 `101210101`、萧山 `101210102`、临安 `101210107`、上海 `101020100`、浦东 `101020600`（`102–208 ms` 全部 `HTTP 200`）；<br>③ `2026-11-17` 最新预报显示 `11.21–22` 五地白天均为晴到多云/阴无雨。 |

### 1.2 逐 3 小时天气解析、置信度与周五刷新机制

1. **为什么必须解析 `var hour3data` 而非笼统日级天气？**
   - 例如 2026-11-22（周日）中国天气网日级摘要曾笼统提示「多云转小雨」，但抽取 `var hour3data` 逐 3 小时数组后发现：`22日08时`、`11时`、`14时`、`17时`、`20时` 全为 `多云 10–15℃`，中雨直到 **`22日23时`** 才抵达杭州与绍兴！若不拆活动时段，极易误杀周日白天干爽返程与出游窗口。
2. **预报置信度与诚实边界**：
   - 周三晚常规发布对应 `3–4 天` 中等置信度（`horizonConfidence: "medium"`）；
   - 当免费 7 天与逐 3 小时页面不含数值降水概率 `%` 时，设置 `precipProbabilityPct: null`、`precipProbabilityStatus: "unconfirmed"`，前端显示「短时降水概率待周五更新（预估）」，严禁编造 `30%` 等数字；
   - **可选升级**：若 Phase 2 Teddy 申请免费**和风天气（QWeather）个人开发 Key**（每日 1000 次免费额度，全周仅消耗 `< 30` 次），可无缝填入 `precipProbabilityPct` 而不改接口结构；未申请前使用已实测通过的 `weather.com.cn` `hour3data` + 周五 17:30 坐标 `wttr.in` 48h 校准，本地缓存 TTL = 6 小时。

### 1.3 两阶段抓取流程与四篇高赞发现笔记逐一复盘

为纠正第二轮「预设 5 个旧地名、忽略高赞发现、凭 15/43 赞低互动笔记定首选」的偏差，第三轮确立**先开放发现、再地名验证**标准流程及互动门槛：

1. **阶段一 · 开放性发现关键词（禁出现任何具体景区/地标名，且排除 `看展 / 美术馆 / 艺术`）**：
   - 生成前先拉取家庭当前「我们不想要的类型（`excludedExperienceTypes`）」列表（默认包含 `art_exhibition` 美术馆/艺术展）；
   - 示例发现词：`上海 周末 草坪 人少`、`杭州周边 开车直达 风景 不用爬`、`江浙沪 周末 带娃 放空`、`杭州周边 农场 采摘 不挤`、`上海周边 水边 住一晚`。
2. **阶段二 · 候选地名验证关键词**：
   - 仅从阶段一高赞（`likes >= 100` 或 `comments >= 10`）且不命中排除类型/体能红线的候选中挑选目标地名，再用具体地名词补抓验证推车、停车与周末人流细节（如 `森兰绿地`、`下渚湖 游船`、`青山湖 水上森林`）。
3. **高赞发现笔记逐篇评论区研判与采纳结论（为什么上一轮没用、本轮用不用）**：

| 序号 / 笔记 | 互动与发布日期 | 上一轮为什么没用 | 本轮评论区核验与采纳结论 |
|---|---|---|---|
| **`#01` 森兰绿地「上海的 Stanley Park」** (`ApeiAb`) | 👍`1369` / ⭐`1026` / 💬`250`<br>`2026-10-25` | 第一轮与第二轮先入为主锁死了「徐汇西岸看展」，人工/打分漏掉了同批发现的浦东超大水岸草坪，只把它记成「浦东草地参考（未单列）」。 | **本轮启用，并列为首选核心线索**。评论区 20 条真实回复显示：附近居住一年的用户直言「每周末都带狗去，真是舒服」、皮划艇赛艇俱乐部在营、公园免费，虽高达 1369 赞但属 300 多万平超大开放草坪而非单一排队店；需结合 Stage 2 验证核对周末停车与推车路段。 |
| **`#06` 1小时车程，杭州5个开车直达山顶的云海** (`独者行山`) | 👍`446` / ⭐`974` / 💬`36`<br>`2026-10-22` | 正文写「日出前 1 小时 5:10 站好、9 点前云散、凌晨山路没路灯、王位山盘山路窄」，且评论指太子尖驿站到顶还需爬升近 200 米且乌泱泱全是人、安顶山山路崎岖。 | **本轮不用（淘汰）**。1 岁 10 个月幼儿不能凌晨 4 点出发吹山顶寒风，也不宜走窄盘山路。 |
| **`#05` 杭州自己的北海道（安吉中国金钱松森林公园）** (`崧木🌱`) | 👍`167` / ⭐`141` / 💬`17`<br>编辑于 `2026-11-07` | 虽于 11-07 重新编辑，但评论区几乎全是 2 月春节下雪问答（年初一/初四雪况），实属季节错位旧帖；同公园 `#11` 实测 4km 小环线爬升 200 米且后半段是台阶。 | **本轮不用（淘汰）**。属于冬雪老帖重编辑，且超出零爬山体能边界。 |
| **`#12` 在安吉走进秋天的油画（安吉中国金钱松森林公园）** (`爱溜达的小李`) | 👍`271` / ⭐`333` / 💬`68`<br>`2026-10-22` | 与 `#05/#11` 同为安吉金钱松森林公园：杭州自驾 1.5h 含单车道盘山公路会车，4km 山林徒步含 200 米爬升，作者评论自认「浅浅用了一下滤镜」且粉丝当日实拍「雨天能见度为 0」。 | **本轮不用（淘汰）**。单车道盘山路+山林爬坡，不符合家庭推车与不折腾边界。 |

---

## 二、5.3 节：浏览器环境、双模实测与技术选型

### 2.1 本机环境与已就绪运行基础

基于 2026-11-16 本机实测核验结果（严格不修改任何生产代码与 Antigravity 插件/MCP 配置）：

| 检查项 | 实测状态 | 说明 |
|---|---|---|
| **Node.js / Playwright** | Node `v24.15.0`；`v2/node_modules/playwright@1.62.1` | 已在两轮实测中稳定驱动 `channel: "chrome"` 抓取小红书、携程与 SPA 官网。 |
| **系统 Chrome** | `C:\Program Files\Google\Chrome\Application\chrome.exe`（`157.0.8103.51`） | 满足持久化 Profile 复用及 `chrome-devtools-mcp` Chrome 144+ 版本基线。 |
| **持久化登录宿主（已落地）** | `C:\Users\teddy\NianlifeOps\weekend-planner\browser-profile\`<br>`relogin.mjs` / `relogin.cmd`（纯 ASCII `336 B`）<br>`storage-state.json` & `storage-state.backup.json` | Teddy 已于 2026-11-16 完成扫码，内含小红书 15 枚 Cookie 与携程 24 枚 Cookie，并在 `raw/2026-11-21/` 留存 41 篇原始 JSON/PNG 与 5 家携程酒店实查留痕。 |
| **Antigravity 插件与 MCP** | 已装仅 `gdrive` 与内置 `swarm`；`~/.gemini/antigravity/mcp_config.json` **不存在**；**未安装 `chrome-devtools-mcp`** | 市场存在 `antigravity-plugins-official/plugin/chrome-devtools-plugin`，本设计阶段遵循红线未安装或改动任何 sidecar/MCP 配置。 |

### 2.2 三种浏览器方案深度对比（含第二轮真实双模实测数据）

| 评估维度 | 方案 1：独立持久化 Chrome Profile + Playwright（**已实测推荐**） | 方案 2：`chrome-devtools-mcp`（附官方参数核实与配置方案） | 方案 3：内置 `browser` 子代理 + `search_web` |
|---|---|---|---|
| **登录态与实测成功率** | **第二轮实测 `10/10` 搜索、`41/41 (100%)` 笔记与评论、携程 `5/5` 实时房价全部成功，0 风控触发**。通过 `launchPersistentContext(..., { channel: "chrome" })` 物理隔离 `browser-profile/`，零干扰日常浏览器。 | 依赖 `--autoConnect`（连接日常默认 Chrome，会占用且干扰工作窗口）或 `--browser-url=http://127.0.0.1:9222`（需常驻手动调试端口 Chrome）；而 `--isolated` 为临时空目录，关闭即销毁 Cookie，无法保留扫码状态。 | 无持久化小红书/携程登录态；第一轮无登录态实测小红书 `0/6`、携程重定向 `/login`；`search_web` 摘要不能替代近 30 天小红书笔记。 |
| **无头 vs 有头双模表现（实测）** | 同词「上海 周末 去哪 人少」实测对照：<br>· **`headless: true`**：`HTTP 200` · `7164 ms` · `22` 张卡片 · `loginModal: false` · `captcha: false`；<br>· **`headless: false`**：`HTTP 200` · `6655 ms` · `22` 张卡片 · `loginModal: false` · `captcha: false`。<br>**结论**：携带持久化 Profile 时，`headless: true` 完全可用，定时任务可真正后台静默执行不弹窗口抢焦点！ | 无内建批量编排限速能力，且大量 DOM 提取需模型逐轮调 MCP 工具，Token 与延迟远高于确定性 Playwright 脚本。 | 适合周三、周五交叉核验官网详情页；不能满足核心门槛。 |

#### 附：`chrome-devtools-mcp` 官方最新 CLI 参数核实（仅作人工排障可选配置，当前未改动系统配置）

核实 `ChromeDevTools/chrome-devtools-mcp` 官方参数与互斥限制：
- `--autoConnect`：自动连接运行中的 Chrome 144+（需在 `chrome://inspect/#remote-debugging` 开启远程调试并点授权弹窗），**不可与 `--browser-url` / `--isolated` / `--executablePath` 混用**；
- `--browser-url=http://127.0.0.1:9222`：附着已以 `--remote-debugging-port=9222` 启动的指定 Chrome 实例，**不可与 `--autoConnect` 或 `--isolated` 同用**；
- `--isolated`：每次启动一次性临时目录，退出即清除（不保留登录态）；
- `--no-usage-statistics`：关闭匿名调用遥测。

如后续需临时用 Antigravity 人工调试某复杂页面，仅建议以独立端口连接专用目录（**未写入系统配置**）：
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222", "--no-usage-statistics"]
    }
  }
}
```

### 2.3 登录态维护、开机联网依赖与每周抓取量估算

1. **两条硬性运行前置依赖（重要）**：
   - **前置 1 · 周一至周三 `20:00` 本机开机且联网**：小红书/携程持久化采集脚本运行在 Teddy 本地 Windows 机器的 `C:/Users/teddy/NianlifeOps/weekend-planner/browser-profile/`；若周一至周三夜间电脑处于关机、休眠或断网状态，定时会话无法完成采集。
   - **前置 2 · 持久化登录态周期性保鲜**：小红书 Web Cookie 预计维持 **14–30 天**，携程约 **5–14 天**。一旦脚本检测到跳转 `/login`、`passport.ctrip.com/user/login`、出现 `.login-container`、缺有效 `xsec_token` 或命中真验证码/滑块文本（注意：**已校准排除 `[class*="slider"]` 对笔记正文图集轮播组件的误匹配**），立即硬熔断停抓。
2. **两种失效下如何向 Teddy 通知与页面呈现**：
   - **情况 A（登录态失效 / 风控停抓）**：立即停止该源并写入 `auth-status.json`；向手机 Webhook（Bark / 企微 / Server酱）推送具体原因（如「小红书登录态已过期，请双击桌面的 `relogin.cmd` 扫码 20 秒重登」）；若周三 `20:30` 前仍未能凑齐每方案 `>= 2` 篇近 30 天小红书笔记，则**发布 `status: "unavailable"` 快照**，页面呈现「本周推荐暂未更新」，并在首页与 `/travel?view=plan` 顶栏显示轻量温和的重登提醒（零技术黑话/报错码）。
   - **情况 B（周一至周三 `20:00` 本机未开机未联网）**：Windows 计划任务配置 `StartWhenAvailable`（开机后自动补运行，配合本地时间判断）；若周三 `21:00` 仍无当周新包上线，前端 `content.ts` 检测到 `current.json` 仍指向往期周末且已过期，**自动向家庭展示「本周推荐暂未更新」（`status: "unavailable"`）并保留带明显旧日期标签的往期归档**；电脑一经唤醒联网，`run-weekly.mjs` 自动补跑并推送「补采已触发/需要扫码重登」通知。
3. **每周抓取量与耗时（实测校准）**：
   - 依据第二轮实测（10 关键词 / 41 篇笔记 / 53 次请求，8.5–15s 随机间隔，单篇平均 `5919 ms`）总计约 `12–16 分钟`；正式周更拆分为：
     - **周一 `20:00`（初抓）**：`8–10` 关键词 + `25–35` 篇近 30 天笔记详情 + `4` 城 `hour3data` 天气 ≈ `8–11 分钟`；
     - **周二 `20:00`（补抓核验）**：仅补采新词缺口（`5–10` 篇）+ 携程 `4–6` 家酒店实查 + 官网详情页 ≈ `4–5 分钟`；
     - **周五 `17:30`（增量刷新）**：`4` 城 `hour3data` + 坐标 `wttr.in` + 已选 3 方案官网公告 ≈ `1–2 分钟`；
     - **周日 `20:30`（反馈调权）**：只读拉取 `state/<weekId>.json`，零外部网页抓取 ≈ `< 1 分钟`。

---

## 三、5.4 节：稳定性、反风控校准与诚实能力清单

### 3.1 模拟正常浏览与防风控校准

1. **严格串行 + 随机抖动**：`concurrency = 1`，每次请求间隔 **8–20 秒**随机等待；单轮补抓控制在 `<= 8` 个关键词、`<= 30` 篇笔记；第一阶段严格仅使用不含具体景区/地标且排除「看展/美术馆/艺术」的开放发现词，发现优胜候选后再进入第二阶段地名验证。
2. **精确风控熔断器（已实测校准）**：
   - 第二轮 Batch 1 第 3 次请求曾因泛化选择器 `[class*="slider"]` 误匹配笔记图集轮播组件触发保护早停；经人工查看截图核实无滑块后，已收紧风控判定器为「真实验证文本（如“访问过于频繁/拖动滑块/请完成验证”）+ 验证码 iframe + 登录弹窗/跳转 URL」。
   - 一旦命中真验证码或登录墙，**立即停止该次抓取并报告 Teddy（绝不绕过）**，保留 `storage-state.backup.json` 与现场截图留痕。
3. **素材铁律**：只读取与提炼结构化文本线索（`noImageUsed: true`），不下载、转存或直链小红书原图到 Nianlife 前端；不把无来源酒店参考价格区间写入数据。

### 3.2 三栏诚实能力清单（第二轮实测更新版）

| 已经实测通过的能力（Verified） | 还需验证的能力（To Be Verified） | 仍然依赖 Teddy 的事项（Blocked on Teddy） |
|---|---|---|
| **1** | **持久化 Profile 两阶段小红书采集**：`browser-profile/` + `channel: "chrome"` 下 `headless: true`/`false` 双模均通；先后完成 R2 41 篇及 R3 开放发现+地名验证两阶段补抓，0 真风控触发，原始 JSON/PNG 全数落盘 `raw/2026-11-21/`。<br>2. **携程已登录态实时查价**：实测 `2成人+1岁儿童` 成功抓回酒店含早实价、取消截止、儿童政策及警示，准确淘汰超千元与售罄。<br>3. **`weather.com.cn` `var hour3data` 逐 3 小时天气解析**：补齐 `<title>` 城市校验并修正德清站号为 `101210204`，`102–208 ms` 全通。<br>4. **官方详情页 SPA 渲染与链接清洗**：具体详情页可达，清除所有根首页 `verified` 链接。 | 1. **持久化登录态长周期耐久度**：`browser-profile/` 跨 14–30 天后的 Cookie 失效周期与重登恢复闭环。<br>2. **无人值守定时跑批与周末停发降级演练**：断网或清 Cookie 时 `run-weekly.mjs` 自动输出 `status: "unavailable"` 与 Webhook 推送。<br>3. **Phase 1/2 生产基线实机验证**：`Caddyfile.ecs` 免口令放行 `POST /api/weekend-state`、`/srv/nianlife-content/weekend/state` 单独 `:rw` 挂载、`excludedExperienceTypes` 添加/撤销与 `ecs-swap.sh` 切换、`weekend-install` / `revalidate --scope weekend`。<br>4. **周日 5 选 1 轻反馈 & 类型排除联动调权**与 **大众点评/大麦** 低频只读适配。 | 1. **周一至周三 `20:00` 保持本机开机联网**：确保定时自动化能在家里 Windows 主机顺利触发采集。<br>2. **周期性扫码重登**：在收到手机推送或站点顶条提醒后，双击运行 `relogin.cmd` 用约 20 秒重新扫码小红书/携程。<br>3. **Webhook 推送渠道选型**：在 Bark / 企微群机器人 / Server酱 中选定其一提供 Webhook URL（`C1` 已按 Teddy 偏好取消口令）。<br>4. **生产变更审批**：确认 `Caddyfile.ecs`、`deploy-ecs-public.sh`、`ecs-swap.sh` 与 Antigravity 周度自动化任务的改动授权。 |

---

## 四、5.5 节：抽取、核验、淘汰、最晚出发时限与数据模型

### 4.1 流水线逻辑与「没有小红书依据就不推荐」硬闸

```text
[拉取「我们不想要的类型」黑名单] ──► [阶段一: 开放发现词(无地名, 禁看展/美术馆)] ──► [阶段二: 候选地名验证]
        │                                                                                          │
        └──(登录失效 / 验证码 / 未开机抓不到)──► [硬熔断: 发布 status="unavailable" + 推Webhook] ◄────────┘
        │ (成功读取近 30 天笔记与评论)
        ▼
[官网详情页 + 携程实时查价 + weather.com.cn hour3data 3小时天气]
        │
        ▼  (1) 准入校验：>=2 篇近 30 天小红书笔记 + 互动门槛(至少1篇 >=100赞 或 >=10评; 不达标标 weak)
        ▼  (2) 类型排除硬拦截：主锚点/大人期待命中 excludedExperienceTypes 直接出局（默认拦截美术馆/艺术展）
        ▼  (3) 6维度自动淘汰 + Strip-Food Test + 非艺术室内优先兜底 + 酒店 <=1000 元 + 90 天冷却池
        ▼  (4) 自动计算 latestDepartureCutoff（最晚出发时限）与 H1–H9 偏好打分 3槽位正交选拔
        ▼
[WeekendPlannerSnapshot JSON (schema: "nianlife.weekend-planner/1") + XhsCrawlManifest]
```

### 4.2 最晚出发时限（`latestDepartureCutoff`）与硬检验代码逻辑

除了第 3 章既有的体能边界（零爬山/零持续台阶/`<=1.2km` 或反馈收紧至 `0.8km`）、Strip-Food Test（剥离餐饮咖啡后单日或过夜每半日 `>= 2.5h`）、15 分钟串联与 `60–90m` 弹性休息窗（不写死午睡钟点）、非艺术优先 15 分钟内室内备胎、大人期待重定义、酒店 `<= 1000 元/晚`外，核心判定逻辑新增**互动门槛、`signalStrength` 标定与 `excludedExperienceTypes` 三级拦截**：

1. **近 30 天小红书门槛、互动阈值与最晚出发时限推导（TypeScript 核心逻辑）**：

```ts
export function computeLatestDepartureCutoff(params: {
  anchorLastEntryHHMM: string | null; // 如 "16:30" (林地/公园闭园前) 或 "16:00" (下渚湖停入)
  minExperienceMinutes: number; // 至少留足有效体验，如 60~150m
  parkingAndTicketBufferMinutes: number; // 停车进场缓冲，默认 15m
  driveMinutesMax: number; // 从三墩单程预估上限，如上海 150m、德清 55m
  fallbackAction: string;
}): LatestDepartureCutoff {
  if (!params.anchorLastEntryHHMM) {
    return {
      hasCutoff: false,
      anchorClosingTime: "开放式无硬性停入截止",
      cutoffTime: "全天自由发车",
      formulaNote: "无固定闭馆/尾班船闸门限制",
      headline: "无需卡点赶门，按宝宝起床或午睡状态自由发车",
      fallbackAction: params.fallbackAction,
    };
  }
  const [h, m] = params.anchorLastEntryHHMM.split(":").map(Number);
  const cutoffTotalMin =
    h * 60 + m - params.minExperienceMinutes - params.parkingAndTicketBufferMinutes - params.driveMinutesMax;
  const hh = String(Math.floor(cutoffTotalMin / 60)).padStart(2, "0");
  const mm = String(cutoffTotalMin % 60).padStart(2, "0");
  return {
    hasCutoff: true,
    anchorClosingTime: `${params.anchorLastEntryHHMM} 停止入场/尾班发车`,
    cutoffTime: `${hh}:${mm}`,
    formulaNote: `${params.anchorLastEntryHHMM} 停入 - ${params.minExperienceMinutes} 分钟体验 - ${params.parkingAndTicketBufferMinutes} 分钟停车进场 - ${params.driveMinutesMax} 分钟车程上限 = ${hh}:${mm}`,
    headline: `最晚 ${hh}:${mm} 从三墩出发；若过点再出门，建议执行备选切线`,
    fallbackAction: params.fallbackAction,
  };
}

export function evaluateXhsSignalStrength(notes: XhsEvidenceNote[]): "strong" | "weak" {
  const hasHighEngagement = notes.some((n) => {
    const likes = Number(String(n.likes).replace(/[^\d]/g, "")) || 0;
    const totalCommentsMatch = String(n.commentCountText || "").match(/(\d+)/);
    const comments = totalCommentsMatch ? Number(totalCommentsMatch[1]) : n.commentsCaptured || 0;
    return likes >= 100 || comments >= 10;
  });
  return hasHighEngagement ? "strong" : "weak";
}

export function passesXhsAndHardGates(
  candidate: ExtractedCandidate,
  weekStartDay: string,
  excludedExperienceTypes: string[] = ["art_exhibition"]
): { ok: boolean; signalStrength: "strong" | "weak"; reasons: string[] } {
  const reasons: string[] = [];
  // 0. 家庭「不喜欢」体验类型硬拦截
  if (excludedExperienceTypes.includes(candidate.experienceType)) {
    reasons.push(`EXCLUDED_EXPERIENCE_TYPE:${candidate.experienceType}`);
  }

  // 1. 铁律：近 30 天（30 * 86400s）真实小红书笔记 >= 2 篇，且每篇含有效 explore 直跳 URL
  const validNotes = candidate.xhsNotes.filter((n) => {
    const diffDays = (Date.parse(`${weekStartDay}T00:00:00Z`) - Date.parse(`${n.publishedAt}T00:00:00Z`)) / 86_400_000;
    return n.within30Days && diffDays >= 0 && diffDays <= 35 && /xiaohongshu\.com\/explore\/[a-f0-9]+/i.test(n.url) && n.url.includes("xsec_token=");
  });
  if (validNotes.length < 2) reasons.push("MISSING_MIN_2_RECENT_XHS_NOTES");

  // 互动门槛（至少 1 篇 likes>=100 或 comments>=10；否则只能标 weak，禁为主推）
  const signalStrength = evaluateXhsSignalStrength(validNotes);
  if (signalStrength === "weak") reasons.push("WEAK_XHS_ENGAGEMENT_SIGNAL");

  // 2. 酒店预算硬闸：仅保留含早 <= 1000 元且未售罄的候选（无来源参考区间彻底禁入）
  if (candidate.isOvernight) {
    const validHotels = candidate.hotelOptions.filter((h) => !h.soldOut && h.minRateWithBreakfastCny <= 1000);
    if (validHotels.length === 0) reasons.push("NO_AFFORDABLE_HOTEL_UNDER_1000");
  }

  // 3. 剥离餐饮有效内容时长 >= 2.5h（过夜须周六下午与周日上午各自 >= 2.5h；车程估算按真实区间如实说明，不为通过而人为缩短）
  if (candidate.isOvernight) {
    if (candidate.driveMinutesMax > 150) reasons.push("DRIVE_OVER_2_5H_WARNING");
    if (candidate.strippedSatAfternoonHours < 2.5 || candidate.strippedSunMorningHours < 2.5) {
      reasons.push("STRIPPED_CONTENT_BELOW_2_5H");
    }
  } else {
    if (candidate.driveMinutesMax > 90) reasons.push("DAYTRIP_OVER_1_5H");
    if (candidate.strippedBestHalfDayHours < 2.5) reasons.push("DAYTRIP_STRIPPED_BELOW_2_5H");
  }

  // 4. 体能、异味、15分钟备胎与首页链接清洗
  if (candidate.hasMountainClimb || candidate.hasLongStairs || candidate.maxSingleWalkKm > candidate.walkCapKm) {
    reasons.push("MOBILITY_VIOLATION");
  }
  if (candidate.nearbyIndoorAlternatives.length < 1) reasons.push("MISSING_INDOOR_FALLBACK");
  return { ok: reasons.length === 0, signalStrength, reasons };
}
```

### 4.3 免口令直接放行的状态写入与体验类型排除（`/api/weekend-state`）

对齐 [01-product.md](./01-product.md) §5.2 与审批项 C1，**按 Teddy 明确偏好去掉口令校验以及不必要的夫妻投票与微信转发模板**，`POST /api/weekend-state` 专注保存方案选择、周日轻反馈与体验类型排除清单：
1. **无口令直接放行**：不需要 `X-Weekend-Passcode`、不做 `Origin` / `sec-fetch-site` 拦阻，家里打开页面即可直接点选；
2. **结构规整与原子写锁**：支持 `{ selectedProposalId?: string | null, departure?: "sat_morning" | "sat_afternoon", fridayAlertAck?: { adoptedSwap: boolean }, sundayFeedback?: { outcome: SundayOutcome, tags: string[], proposalId: string }, excludeAction?: { action: "add" | "remove", experienceType: string, label: string } }`；目录锁 + temp write + `fsync` + atomic rename 写入 `/srv/nianlife-content/weekend/state/<weekId>.json` 及跨周排除黑名单 `/srv/nianlife-content/weekend/state/excluded-types.json`。

---

### 4.4 完整数据模型 TypeScript 定义（经 `tsc --strict` 校验对齐第二轮全部 JSON）

以下 TypeScript 模型同时涵盖主数据包（`examples/2026-11-21.json`）、小红书采集清单（`examples/xhs-crawl-manifest-2026-11-21.json`）及家庭状态文件（`WeekendStateFile`），所有字段与第二轮实产 JSON 100% 严丝合缝：

```ts
// ========== 1. 通用枚举与用户侧词表 ==========

export type WeekendPlannerStatus =
  | "collecting"
  | "published"
  | "unavailable"
  | "expired"
  | "rest_recommended";

export type VerificationStatus = "verified" | "unconfirmed" | "estimated";
export type ProposalSlot = "preferred" | "alt_local" | "alt_1h";
export type DepartureKey = "sat_morning" | "sat_afternoon";
export type CrowdRiskLevel = "low" | "low_to_medium" | "medium" | "high";
export type SignalStrength = "strong" | "weak";
export type SundayOutcome =
  | "went_loved"
  | "went_adult_meh"
  | "went_tired"
  | "went_pitfall"
  | "stayed_home";

export interface ExcludedExperienceTypeItem {
  experienceType: string;
  label: string;
  excludedAt: string;
  addedBy?: string;
  note?: string;
}

// ========== 2. 小红书近 30 天笔记结构（"小红书怎么说"，零图片） ==========

export interface XhsEvidenceNote {
  seq: number;
  noteId: string;
  title: string;
  author: string;
  publishedAt: string; // YYYY-MM-DD（必须在最近 30 天内）
  within30Days: true;
  likes: string;
  collects: string;
  commentCountText: string;
  commentsCaptured: number;
  url: string; // 必须带有效 xsec_token 直跳详情链接
  keyTakeaway: string;
  commentFeedback: string;
  noImageUsed: true; // 铁律：严禁下载/展示小红书图片
}

// ========== 3. 主周末提案快照（schema: "nianlife.weekend-planner/1"） ==========

export interface WeekendPlannerSnapshot {
  schema: "nianlife.weekend-planner/1";
  weekId: string; // 周六日期 YYYY-MM-DD
  weekendRange: {
    from: string;
    to: string;
    label: string;
    satLabel: string;
    sunLabel: string;
  };
  generatedAt: string;
  status: WeekendPlannerStatus;
  userFacingStatusLabels: {
    verified: "已确认";
    unconfirmed: "待确认";
    estimated: "预估";
  };
  verificationSummaryNote: string;
  publishCadence: {
    collectedAt: string;
    regularPublishTarget: string;
    fridayRefreshTarget: string;
    note: string;
  };
  unavailableNotice?: {
    reason:
      | "xhs_auth_expired"
      | "xhs_risk_stopped"
      | "pc_offline_mon_to_wed"
      | "insufficient_recent_notes";
    headline: string;
    summary: string;
    detectedAt: string;
    actionForTeddy: string;
    fallbackArchiveWeekId?: string;
  };
  fridayAlert?: {
    refreshedAt: string;
    severity: "info" | "adjust";
    headline: string;
    summary: string;
    swapSuggestion?: string;
    keepsSelectedProposal: true;
  };
  restRecommendation?: {
    reason: string;
    weatherOrCrowdTrigger: string;
    microActivities: Array<{
      title: string;
      driveMinutes: string;
      indoor: boolean;
      note: string;
    }>;
  };
  childProfile: {
    name: string;
    birthDay: "2025-01-03";
    ageOnSaturday: string; // ageOn("2025-01-03", weekId) 动态计算
    ageLabel: string;
    ageFormula: string;
    mobilityBoundary: string;
    unconfirmedPreferences: string[];
  };
  familyBaseline: {
    origin: { name: string; lat: number; lng: number };
    transport: string;
    maxDistanceScope: string;
    departureWindow: string;
    crowdAndStyleRule: string;
    hotelBudget: {
      regularTargetRmb: number;
      stretchAllowed: boolean;
      hardCapRmb: 1000;
      party: string;
      note: string;
    };
    totalTripBudget: null;
    totalBudgetPolicy: string;
  };
  weatherSummary: {
    testedAt: string;
    primarySourceLabel: string;
    secondarySourceLabel: string;
    precipProbabilityPct: number | null;
    precipProbabilityStatus: VerificationStatus;
    precipProbabilityNote: string;
    horizonConfidence: "low" | "medium" | "high";
    horizonConfidenceLabel: string;
    fridayRefreshHint: string;
    cities: Array<{
      city: string;
      code: string;
      sourceUrl: string;
      daysSummary: Array<{
        date: string;
        dayLabel: string;
        summary: string;
        wind: string;
      }>;
      hour3Segments: Record<
        string,
        Array<{
          slot: string; // 如 "21日14时"
          condition: string;
          temp: string;
          windDir: string;
          windForce: string;
        }>
      >;
      weekendTip: string;
    }>;
  };
  crawlAudit: {
    testedAt: string;
    manifestPath: string;
    manifestMdPath: string;
    xiaohongshuLoggedIn: {
      profileDir: string;
      authBackupPath: string;
      rateLimitPolicy: {
        concurrency: number;
        randomDelayMsRange: string;
        riskStopRule: string;
        riskStopTriggered: boolean;
        falsePositiveCalibrationNote?: string;
      };
      summary: {
        totalKeywords: number;
        searchSuccessCount: number;
        searchSuccessRate: string;
        totalNavRequests: number;
        notesAttempted: number;
        notesSucceeded: number;
        bodyReadSuccessRate: string;
        within30DaysCount: number;
        notePublishDateRange: string;
        avgNoteElapsedMs: number;
        riskStopCount: number;
      };
      modeComparison: {
        keywordTested: string;
        headless: ModeProbeResult;
        headed: ModeProbeResult;
        conclusion: string;
      };
    };
    ctripLoggedIn: {
      testedAt: string;
      searchCondition: string;
      hotelsChecked: number;
      withinBudgetOptions: Array<{
        name: string;
        hotelId: string;
        ratesSummary: string;
        url: string;
      }>;
      eliminatedOptions: Array<{
        name: string;
        reason: string;
        rawJson: string;
      }>;
    };
    weatherAndOfficial: {
      weatherLatencyRangeMs: string;
      openMeteoStatus: string;
      officialDetailPagesVerified: string[];
    };
  };
  excludedExperienceTypes?: ExcludedExperienceTypeItem[];
  proposals: WeekendProposal[];
  inspirationPool: InspirationItem[];
  noGoAlerts: NoGoAlert[];
}

export interface ModeProbeResult {
  mode: string;
  httpStatus: number;
  elapsedMs: number;
  noteCardCount: number;
  loginModal: boolean;
  captcha: boolean;
  screenshot: string;
  screenshotVerifiedOnDisk: boolean;
}

export interface WeekendProposal {
  id: string;
  slot: ProposalSlot;
  rank: number;
  badge: string;
  experienceType: string;
  experienceTypeLabel: string;
  signalStrength: SignalStrength;
  signalStrengthLabel?: string;
  title: string;
  subtitle: string;
  region: string;
  isOvernight: boolean;
  paceLabel: string;
  heroImage?: {
    src: string; // 原型使用本地 assets/，生产入库只走 OSS，严禁用小红书图或占位背景
    alt: string;
    caption: string;
    sourcePage: string;
    timeNote?: string;
  };
  galleryImages?: Array<{
    src: string;
    alt: string;
    caption: string;
    sourcePage: string;
    timeNote?: string;
  }>;
  driveFromSandun: {
    distanceKmEstimate: number;
    durationMinutesRange: [number, number];
    durationLabel: string;
    directionFromSandun: string;
    verificationStatus: VerificationStatus;
  };
  latestDepartureCutoff: {
    hasCutoff: boolean;
    anchorClosingTime: string;
    eveningBackupClosingTime?: string;
    cutoffTime: string;
    cutoffTimeRelaxed?: string;
    formulaNote: string;
    headline: string;
    fallbackAction: string;
  };
  weatherSlots: Array<{
    slotLabel: string;
    condition: string;
    tempRangeC: string;
    wind: string;
    precipRiskNote: string;
  }>;
  xhsEvidence: {
    digest: string;
    commentSignals: string;
    notes: XhsEvidenceNote[];
  };
  oneLineReason: string;
  worthGoingChecks: {
    coreAnchorAndReason: WorthGoingCheckItem;
    driveToContentRatio: WorthGoingCheckItem;
    loop15MinAndRestWindow: WorthGoingCheckItem;
    rainOrFailBackup: WorthGoingCheckItem;
    adultDelight: WorthGoingCheckItem;
    notJustDiningCounterCheck: WorthGoingCheckItem;
  };
  urgentBookingsTonight: Array<{
    item: string;
    required: boolean;
    deadline: string;
    channel: string;
    verificationStatus: VerificationStatus;
    note: string;
  }>;
  departures: Record<DepartureKey, DeparturePlan>;
  degradationTree: {
    rain: DegradationBranch;
    childTired: DegradationBranch;
    crowded: DegradationBranch;
    returnEarly: DegradationBranch;
  };
  crowdAndTraffic: {
    roadPattern: {
      basis: "historical_weekend_pattern" | "historical_and_xhs_pattern";
      isEstimate: true;
      summary: string;
      bestDepartureWindow: string;
      avoidWindow: string;
    };
    venueCrowd: {
      riskLevel: CrowdRiskLevel;
      isEstimate: true;
      peakHours: string;
      offPeakTip: string;
      signals: string[];
    };
  };
  hotel:
    | { required: false; note: string }
    | {
        required: true;
        budgetConstraint: string;
        preferenceSummary?: string;
        recommendationReason?: string;
        areaComparisonNote?: string;
        searchQueryParams: {
          checkIn: string;
          checkOut: string;
          rooms: number;
          adults: number;
          children: number;
          childAgeParam: string;
          capturedAt: string;
          verificationStatus: VerificationStatus;
        };
        options: Array<{
          rank: number;
          tag: string;
          name: string;
          brandType?: string;
          districtArea?: string;
          address: string;
          rating: string;
          recommendedRoom: string;
          bedSpec?: string;
          liveRatesCny: {
            note: string;
            [rateField: string]: number | string;
          };
          freeCancellationDeadline: string;
          childAndCribPolicy: string;
          cribStatusNote?: string;
          poolSummary?: string;
          poolStatus?: VerificationStatus;
          parkingPolicy: string;
          parkingStatus: VerificationStatus;
          routingNote?: string;
          capturedAt?: string;
          verificationStatus: VerificationStatus;
          bookingUrl: string;
        }>;
        eliminatedOptions: Array<{
          name: string;
          status: "over_budget" | "sold_out" | "eliminated";
          priceFound: string;
          reason: string;
        }>;
      };
  costBreakdown: {
    totalTripBudgetSet: false;
    totalBudgetNote: string;
    items: Array<{
      label: string;
      amountText: string;
      verificationStatus: VerificationStatus;
      note: string;
    }>;
  };
  sources: Array<{
    title: string;
    url: string;
    sourceType: string;
    verificationStatus: VerificationStatus;
    verifiedAt: string;
    note?: string;
  }>;
}

export interface WorthGoingCheckItem {
  label: string;
  status: VerificationStatus;
  detail: string;
}

export interface DeparturePlan {
  label: string;
  departureTime: string;
  arrivalEstimate: string;
  trimNote: string;
  returnTime: string;
  timeline: Array<{
    timeWindow: string;
    segmentKey: string;
    title: string;
    location: string;
    slotWeather3h: string;
    driveOrWalkNote: string;
    strollerAndRestNote: string;
    isRestBuffer: boolean;
    category: string;
  }>;
}

export interface DegradationBranch {
  triggerLabel: string;
  actionSummary: string;
  nearbyAlternatives: Array<{
    name: string;
    driveOrWalk: string;
    indoor: boolean;
    parking: string;
    note: string;
  }>;
  returnRouteHint: string;
}

export interface InspirationItem {
  id: string;
  poolKind: "seasonalLimited" | "evergreen";
  poolTag: string;
  availabilityStatus: "active" | "blocked";
  experienceType?: string;
  experienceTypeLabel?: string;
  signalStrength?: SignalStrength;
  title: string;
  region: string;
  driveFromSandun: string;
  whyThisWeek: string;
  keyFacts: {
    openingHours: string;
    bookingRequired: boolean;
    bookingChannel: string;
    ticketSummary: string;
    strollerNote: string;
    bookingAvailabilityStatus?: VerificationStatus;
    ticketPolicyStatus?: VerificationStatus;
  };
  verificationStatus: VerificationStatus;
  verifiedAt: string;
  xhsEvidence: XhsEvidenceNote[];
  sources: string[];
}

export interface NoGoAlert {
  id: string;
  severity: "high" | "medium" | "low";
  venue: string;
  blockedRange: string;
  reason: string;
  verificationStatus: VerificationStatus;
  verifiedAt: string;
  sourceUrl: string;
}

// ========== 4. 小红书实采清单结构（schema: "nianlife.xhs-crawl-manifest/1"） ==========

export interface XhsCrawlManifest {
  schema: "nianlife.xhs-crawl-manifest/1";
  weekId: string;
  generatedAt: string;
  profileDir: string;
  authBackupPath: string;
  rawDir: string;
  crawlWindowDays: number;
  targetDateRange: { from: string; to: string };
  rateLimitPolicy: {
    concurrency: number;
    randomDelayMsRange: string;
    riskStopRule: string;
    riskStopTriggered: boolean;
    falsePositiveCalibrationNote?: string;
  };
  summary: {
    totalKeywords: number;
    searchSuccessCount: number;
    searchSuccessRate: string;
    totalNavRequests: number;
    notesAttempted: number;
    notesSucceeded: number;
    bodyReadSuccessRate: string;
    within30DaysCount: number;
    notePublishDateRange: string;
    avgNoteElapsedMs: number;
    riskStopCount: number;
  };
  round3SupplementalSummary?: {
    totalKeywords: number;
    stage1OpenDiscoveryKeywords: number;
    stage1NotesCaptured: number;
    stage2PlaceVerifyKeywords: number;
    stage2NotesCaptured: number;
    totalNotesCaptured: number;
    totalNavRequests: number;
    excludedArtKeywordsEnforced: boolean;
    riskStopTriggered: boolean;
  };
  round4SupplementalSummary?: {
    totalKeywords: number;
    stage1OpenDiscoveryKeywords: number;
    stage1NotesCaptured: number;
    stage2PlaceVerifyKeywords: number;
    stage2NotesCaptured: number;
    totalNotesCaptured: number;
    totalNavRequests: number;
    excludedArtKeywordsEnforced: boolean;
    riskStopTriggered: boolean;
  };
  highLikeAuditR3?: Array<{
    seq: number;
    title: string;
    likes: string;
    comments: number;
    r2Reason: string;
    r3Decision: string;
  }>;
  modeComparison: {
    keywordTested: string;
    headless: ModeProbeResult;
    headed: ModeProbeResult;
    conclusion: string;
  };
  keywordBatches: Array<{
    index: number;
    crawlStage?: string;
    keyword: string;
    searchUrl: string;
    usedFilter: string;
    elapsedMs: number;
    totalCardsLoaded: number;
    recent30DayCandidateCount: number;
    pickedCount: number;
    success: boolean;
  }>;
  notes: Array<{
    seq: number;
    discoveryRound?: string;
    keyword: string;
    noteId: string;
    noteUrl: string;
    title: string;
    author: string;
    publishDateRaw: string;
    publishDate: string;
    within30Days: boolean;
    likes: string;
    likesNum?: number;
    collects: string;
    commentCountText: string;
    totalCommentsNum?: number;
    commentsCaptured: number;
    meetsEngagementThreshold?: boolean;
    bodyPreview100: string;
    bodyTextLength: number;
    extractedFacts: {
      places: string[];
      timing: string;
      crowd: string;
      toddler: string;
      stroller: string;
      pitfall: string;
    };
    crawledAt: string;
    elapsedMs: number;
    bodyReadSuccess: boolean;
    rawJsonPath: string;
    rawPngPath: string;
    rawFilesVerifiedOnDisk: boolean;
    usageTarget: string;
    usageLabel: string;
  }>;
}

// ========== 5. ECS 家庭可写状态文件（schema: "nianlife.weekend-state/1"） ==========

export interface WeekendStateFile {
  schema: "nianlife.weekend-state/1";
  weekId: string;
  updatedAt: string | null;
  selectedProposalId: string | null;
  selectedDeparture: DepartureKey | null;
  checklist: Record<string, boolean>;
  fridayAlertAck: {
    adoptedSwap: boolean;
    updatedAt: string | null;
  };
  sundayFeedback: {
    outcome: SundayOutcome | null;
    tags: string[];
    submittedAt: string | null;
    proposalId: string | null;
  };
  excludedExperienceTypes: ExcludedExperienceTypeItem[];
}
```

### 4.5 JSON Schema（Draft 2020-12，与 `examples/2026-11-21.json` 及 `xhs-crawl-manifest-2026-11-21.json` 严丝合缝）

#### A. 主周报数据包 Schema（`nianlife.weekend-planner/1`）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nianlife.cn/schemas/weekend-planner-1.json",
  "title": "Nianlife Weekend Planner Snapshot",
  "type": "object",
  "required": [
    "schema", "weekId", "weekendRange", "generatedAt", "status",
    "userFacingStatusLabels", "verificationSummaryNote", "publishCadence",
    "childProfile", "familyBaseline", "weatherSummary", "crawlAudit",
    "proposals", "inspirationPool", "noGoAlerts"
  ],
  "properties": {
    "schema": { "const": "nianlife.weekend-planner/1" },
    "weekId": { "type": "string", "pattern": "^20[2-9]\\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
    "weekendRange": {
      "type": "object",
      "required": ["from", "to", "label", "satLabel", "sunLabel"],
      "properties": {
        "from": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "to": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "label": { "type": "string", "minLength": 1 },
        "satLabel": { "type": "string", "minLength": 1 },
        "sunLabel": { "type": "string", "minLength": 1 }
      }
    },
    "generatedAt": { "type": "string", "minLength": 10 },
    "status": { "type": "string", "enum": ["collecting", "published", "unavailable", "expired", "rest_recommended"] },
    "userFacingStatusLabels": {
      "type": "object",
      "required": ["verified", "unconfirmed", "estimated"],
      "properties": {
        "verified": { "const": "已确认" },
        "unconfirmed": { "const": "待确认" },
        "estimated": { "const": "预估" }
      }
    },
    "verificationSummaryNote": { "type": "string", "minLength": 1 },
    "publishCadence": {
      "type": "object",
      "required": ["collectedAt", "regularPublishTarget", "fridayRefreshTarget", "note"]
    },
    "unavailableNotice": {
      "type": "object",
      "required": ["reason", "headline", "summary", "detectedAt", "actionForTeddy"],
      "properties": {
        "reason": { "type": "string", "enum": ["xhs_auth_expired", "xhs_risk_stopped", "pc_offline_mon_to_wed", "insufficient_recent_notes"] }
      }
    },
    "fridayAlert": {
      "type": "object",
      "required": ["refreshedAt", "severity", "headline", "summary", "keepsSelectedProposal"],
      "properties": {
        "severity": { "type": "string", "enum": ["info", "adjust"] },
        "keepsSelectedProposal": { "const": true }
      }
    },
    "childProfile": {
      "type": "object",
      "required": ["name", "birthDay", "ageOnSaturday", "ageLabel", "ageFormula", "mobilityBoundary", "unconfirmedPreferences"],
      "properties": {
        "birthDay": { "const": "2025-01-03" },
        "unconfirmedPreferences": { "type": "array", "items": { "type": "string" } }
      }
    },
    "familyBaseline": {
      "type": "object",
      "required": ["origin", "transport", "maxDistanceScope", "departureWindow", "crowdAndStyleRule", "hotelBudget", "totalTripBudget", "totalBudgetPolicy"],
      "properties": {
        "hotelBudget": {
          "type": "object",
          "required": ["regularTargetRmb", "stretchAllowed", "hardCapRmb", "party", "note"],
          "properties": { "hardCapRmb": { "const": 1000 } }
        },
        "totalTripBudget": { "type": "null" }
      }
    },
    "weatherSummary": {
      "type": "object",
      "required": [
        "testedAt", "primarySourceLabel", "secondarySourceLabel",
        "precipProbabilityPct", "precipProbabilityStatus", "precipProbabilityNote",
        "horizonConfidence", "horizonConfidenceLabel", "fridayRefreshHint", "cities"
      ],
      "properties": {
        "precipProbabilityStatus": { "$ref": "#/$defs/verificationStatus" },
        "horizonConfidence": { "type": "string", "enum": ["low", "medium", "high"] },
        "cities": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["city", "code", "sourceUrl", "daysSummary", "hour3Segments", "weekendTip"]
          }
        }
      }
    },
    "crawlAudit": {
      "type": "object",
      "required": ["testedAt", "manifestPath", "manifestMdPath", "xiaohongshuLoggedIn", "ctripLoggedIn", "weatherAndOfficial"]
    },
    "excludedExperienceTypes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["experienceType", "label", "excludedAt", "addedBy"],
        "properties": {
          "experienceType": { "type": "string", "minLength": 1 },
          "label": { "type": "string", "minLength": 1 },
          "excludedAt": { "type": "string", "minLength": 10 },
          "addedBy": { "type": "string", "enum": ["sujing", "teddy", "family_rule"] }
        }
      }
    },
    "proposals": {
      "type": "array",
      "maxItems": 3,
      "items": { "$ref": "#/$defs/proposal" }
    },
    "inspirationPool": {
      "type": "array",
      "items": { "$ref": "#/$defs/inspirationItem" }
    },
    "noGoAlerts": {
      "type": "array",
      "items": { "$ref": "#/$defs/noGoAlert" }
    }
  },
  "$defs": {
    "verificationStatus": { "type": "string", "enum": ["verified", "unconfirmed", "estimated"] },
    "xhsEvidenceNote": {
      "type": "object",
      "required": [
        "seq", "noteId", "title", "author", "publishedAt", "within30Days",
        "likes", "collects", "commentCountText", "commentsCaptured",
        "url", "keyTakeaway", "commentFeedback", "noImageUsed"
      ],
      "properties": {
        "publishedAt": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "within30Days": { "const": true },
        "url": { "type": "string", "pattern": "^https://www\\.xiaohongshu\\.com/explore/[a-zA-Z0-9]+\\?.*xsec_token=" },
        "noImageUsed": { "const": true }
      }
    },
    "worthGoingItem": {
      "type": "object",
      "required": ["label", "status", "detail"],
      "properties": { "status": { "$ref": "#/$defs/verificationStatus" } }
    },
    "departurePlan": {
      "type": "object",
      "required": ["label", "departureTime", "arrivalEstimate", "trimNote", "returnTime", "timeline"],
      "properties": {
        "timeline": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": [
              "timeWindow", "segmentKey", "title", "location", "slotWeather3h",
              "driveOrWalkNote", "strollerAndRestNote", "isRestBuffer", "category"
            ],
            "properties": { "isRestBuffer": { "type": "boolean" } }
          }
        }
      }
    },
    "degradationBranch": {
      "type": "object",
      "required": ["triggerLabel", "actionSummary", "nearbyAlternatives", "returnRouteHint"],
      "properties": {
        "nearbyAlternatives": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "driveOrWalk", "indoor", "parking", "note"],
            "properties": { "indoor": { "type": "boolean" } }
          }
        }
      }
    },
    "proposal": {
      "type": "object",
      "required": [
        "id", "slot", "rank", "badge", "experienceType", "experienceTypeLabel", "signalStrength",
        "title", "subtitle", "region", "isOvernight",
        "paceLabel", "driveFromSandun", "latestDepartureCutoff", "weatherSlots",
        "xhsEvidence", "oneLineReason", "worthGoingChecks", "urgentBookingsTonight",
        "departures", "degradationTree", "crowdAndTraffic", "hotel", "costBreakdown", "sources"
      ],
      "properties": {
        "slot": { "type": "string", "enum": ["preferred", "alt_local", "alt_1h"] },
        "rank": { "type": "integer", "minimum": 1, "maximum": 3 },
        "experienceType": { "type": "string", "minLength": 1 },
        "experienceTypeLabel": { "type": "string", "minLength": 1 },
        "signalStrength": { "type": "string", "enum": ["strong", "weak"] },
        "isOvernight": { "type": "boolean" },
        "driveFromSandun": {
          "type": "object",
          "required": ["distanceKmEstimate", "durationMinutesRange", "durationLabel", "directionFromSandun", "verificationStatus"],
          "properties": {
            "durationMinutesRange": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "number" } },
            "verificationStatus": { "$ref": "#/$defs/verificationStatus" }
          }
        },
        "latestDepartureCutoff": {
          "type": "object",
          "required": ["hasCutoff", "anchorClosingTime", "cutoffTime", "formulaNote", "headline", "fallbackAction"],
          "properties": { "hasCutoff": { "type": "boolean" } }
        },
        "weatherSlots": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["slotLabel", "condition", "tempRangeC", "wind", "precipRiskNote"]
          }
        },
        "xhsEvidence": {
          "type": "object",
          "required": ["digest", "commentSignals", "notes"],
          "properties": {
            "notes": { "type": "array", "minItems": 2, "items": { "$ref": "#/$defs/xhsEvidenceNote" } }
          }
        },
        "worthGoingChecks": {
          "type": "object",
          "required": [
            "coreAnchorAndReason", "driveToContentRatio", "loop15MinAndRestWindow",
            "rainOrFailBackup", "adultDelight", "notJustDiningCounterCheck"
          ],
          "properties": {
            "coreAnchorAndReason": { "$ref": "#/$defs/worthGoingItem" },
            "driveToContentRatio": { "$ref": "#/$defs/worthGoingItem" },
            "loop15MinAndRestWindow": { "$ref": "#/$defs/worthGoingItem" },
            "rainOrFailBackup": { "$ref": "#/$defs/worthGoingItem" },
            "adultDelight": { "$ref": "#/$defs/worthGoingItem" },
            "notJustDiningCounterCheck": { "$ref": "#/$defs/worthGoingItem" }
          }
        },
        "urgentBookingsTonight": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["item", "required", "deadline", "channel", "verificationStatus", "note"],
            "properties": {
              "required": { "type": "boolean" },
              "verificationStatus": { "$ref": "#/$defs/verificationStatus" }
            }
          }
        },
        "departures": {
          "type": "object",
          "required": ["sat_morning", "sat_afternoon"],
          "properties": {
            "sat_morning": { "$ref": "#/$defs/departurePlan" },
            "sat_afternoon": { "$ref": "#/$defs/departurePlan" }
          }
        },
        "degradationTree": {
          "type": "object",
          "required": ["rain", "childTired", "crowded", "returnEarly"],
          "properties": {
            "rain": { "$ref": "#/$defs/degradationBranch" },
            "childTired": { "$ref": "#/$defs/degradationBranch" },
            "crowded": { "$ref": "#/$defs/degradationBranch" },
            "returnEarly": { "$ref": "#/$defs/degradationBranch" }
          }
        },
        "crowdAndTraffic": {
          "type": "object",
          "required": ["roadPattern", "venueCrowd"],
          "properties": {
            "roadPattern": {
              "type": "object",
              "required": ["basis", "isEstimate", "summary", "bestDepartureWindow", "avoidWindow"],
              "properties": {
                "basis": { "type": "string", "enum": ["historical_weekend_pattern", "historical_and_xhs_pattern"] },
                "isEstimate": { "const": true }
              }
            },
            "venueCrowd": {
              "type": "object",
              "required": ["riskLevel", "isEstimate", "peakHours", "offPeakTip", "signals"],
              "properties": {
                "riskLevel": { "type": "string", "enum": ["low", "low_to_medium", "medium", "high"] },
                "isEstimate": { "const": true }
              }
            }
          }
        },
        "hotel": {
          "oneOf": [
            {
              "type": "object",
              "required": ["required", "note"],
              "properties": { "required": { "const": false } }
            },
            {
              "type": "object",
              "required": ["required", "budgetConstraint", "searchQueryParams", "options", "eliminatedOptions"],
              "properties": {
                "required": { "const": true },
                "options": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "object",
                    "required": [
                      "rank", "tag", "name", "address", "rating", "recommendedRoom",
                      "liveRatesCny", "freeCancellationDeadline", "childAndCribPolicy",
                      "parkingPolicy", "parkingStatus", "verificationStatus", "bookingUrl"
                    ],
                    "properties": {
                      "parkingStatus": { "$ref": "#/$defs/verificationStatus" },
                      "verificationStatus": { "$ref": "#/$defs/verificationStatus" }
                    }
                  }
                }
              }
            }
          ]
        },
        "costBreakdown": {
          "type": "object",
          "required": ["totalTripBudgetSet", "totalBudgetNote", "items"],
          "properties": {
            "totalTripBudgetSet": { "const": false },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["label", "amountText", "verificationStatus", "note"],
                "properties": { "verificationStatus": { "$ref": "#/$defs/verificationStatus" } }
              }
            }
          }
        },
        "sources": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["title", "url", "sourceType", "verificationStatus", "verifiedAt"],
            "properties": { "verificationStatus": { "$ref": "#/$defs/verificationStatus" } }
          }
        }
      }
    },
    "inspirationItem": {
      "type": "object",
      "required": [
        "id", "poolKind", "poolTag", "availabilityStatus", "title", "region",
        "driveFromSandun", "whyThisWeek", "keyFacts", "verificationStatus",
        "verifiedAt", "xhsEvidence", "sources"
      ],
      "properties": {
        "poolKind": { "type": "string", "enum": ["seasonalLimited", "evergreen"] },
        "availabilityStatus": { "type": "string", "enum": ["active", "blocked"] },
        "experienceType": { "type": "string" },
        "experienceTypeLabel": { "type": "string" },
        "signalStrength": { "type": "string", "enum": ["strong", "weak"] },
        "verificationStatus": { "$ref": "#/$defs/verificationStatus" },
        "xhsEvidence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/xhsEvidenceNote" } }
      }
    },
    "noGoAlert": {
      "type": "object",
      "required": ["id", "severity", "venue", "blockedRange", "reason", "verificationStatus", "verifiedAt", "sourceUrl"],
      "properties": {
        "severity": { "type": "string", "enum": ["high", "medium", "low"] },
        "verificationStatus": { "$ref": "#/$defs/verificationStatus" }
      }
    }
  }
}
```

#### B. 小红书采集清单 Schema（`nianlife.xhs-crawl-manifest/1`）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nianlife.cn/schemas/xhs-crawl-manifest-1.json",
  "title": "Nianlife XHS Crawl Manifest",
  "type": "object",
  "required": [
    "schema", "weekId", "generatedAt", "profileDir", "authBackupPath", "rawDir",
    "crawlWindowDays", "targetDateRange", "rateLimitPolicy", "summary",
    "modeComparison", "keywordBatches", "notes"
  ],
  "properties": {
    "schema": { "const": "nianlife.xhs-crawl-manifest/1" },
    "weekId": { "type": "string", "pattern": "^20[2-9]\\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
    "crawlWindowDays": { "type": "integer", "minimum": 1, "maximum": 30 },
    "targetDateRange": {
      "type": "object",
      "required": ["from", "to"]
    },
    "rateLimitPolicy": {
      "type": "object",
      "required": ["concurrency", "randomDelayMsRange", "riskStopRule", "riskStopTriggered"],
      "properties": {
        "concurrency": { "const": 1 },
        "riskStopTriggered": { "type": "boolean" }
      }
    },
    "summary": {
      "type": "object",
      "required": [
        "totalKeywords", "searchSuccessCount", "searchSuccessRate", "totalNavRequests",
        "notesAttempted", "notesSucceeded", "bodyReadSuccessRate", "within30DaysCount",
        "notePublishDateRange", "avgNoteElapsedMs", "riskStopCount"
      ]
    },
    "keywordBatches": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["index", "keyword", "searchUrl", "usedFilter", "elapsedMs", "totalCardsLoaded", "recent30DayCandidateCount", "pickedCount", "success"]
      }
    },
    "notes": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "seq", "keyword", "noteId", "noteUrl", "title", "author",
          "publishDateRaw", "publishDate", "within30Days", "likes", "collects",
          "commentCountText", "commentsCaptured", "bodyPreview100", "bodyTextLength",
          "extractedFacts", "crawledAt", "elapsedMs", "bodyReadSuccess",
          "rawJsonPath", "rawPngPath", "rawFilesVerifiedOnDisk", "usageTarget", "usageLabel"
        ],
        "properties": {
          "extractedFacts": {
            "type": "object",
            "required": ["places", "timing", "crowd", "toddler", "stroller", "pitfall"]
          }
        }
      }
    }
  }
}
```

---

## 五、第 7 节：每周自动化节奏、ECS 发布与成本核算

### 5.1 每周自动化调度时间表（错开每日 23:30 同步与 00:30 审编）

对照 [docs/daily-editor.md](../daily-editor.md)，每日 `23:30` 运行微信与夸克同步（持有 `sync.lock`），每日 `00:30` 运行 Antigravity 每日审编。「周末去哪」全部任务均错峰运行在晚间早段与周五傍晚，并依赖 Teddy 本地电脑在 **周一至周三 `20:00` 开机联网**：

| 调度时间（`Asia/Shanghai`） | 阶段命令 | 核心动作与失败降级行为 |
|---|---|---|
| **周一 `20:00`** | `collect-init` | 抓 4 城 `hour3data`、串行跑小红书持久化采集（8.5–15s 抖动，<=10 词/<=50 篇）保存 `raw/<weekId>/` 与 `manifest`。若命中登录失效或风控立刻停止并推送重登通知。 |
| **周二 `20:00`** | `verify-deep` | 补抓缺口笔记、携程登录态实时酒店查价（固定 2 大+1 名动态算得 `ageOn` 幼儿）、官网详情页与闭馆核验；**清理根首页假 `verified` 链接**。 |
| **周三 `20:00`（`21:00` 前上线）** | `build-and-publish` | 校验每方案 `>=2` 篇近 30 天小红书笔记硬门槛、跑 6 维度硬检验与 `latestDepartureCutoff` 计算、3 槽位正交选拔与 Schema 校验；**若小红书未达门槛（登录失效/风控/前期未开机补采仍失败）则强制产出 `status: "unavailable"` 并推送通知**。最后调用 `deploy-ecs-public.sh weekend-install` + ECS 环回 `revalidate --scope weekend`。 |
| **周五 `17:30`** | `refresh-friday` | 刷新 `weather.com.cn` `hour3data` 48h + 坐标 `wttr.in`（含精准降水信号）+ 临时闭馆核查；先读线上 `state/<weekId>.json` 确认**已有 `pick` 时绝不推翻重排**，仅追加 `fridayAlert` 并原子安装刷新。 |
| **周日 `20:30`** | `sync-feedback` | 只读拉取 ECS `state/<weekId>.json` 中的 `sundayFeedback`，更新私有 `preference-weights.json` 与 90 天 `cooldown-venues.json`；若成行仅生成只读 `Candidate Hint` 供每日审编核对（**绝不直写 `trips.json`**）。 |

### 5.2 独立互斥锁 `weekend.lock` 与仓库外私有账本

- **独立锁**：`C:/Users/teddy/NianlifeOps/ops-daily/state/weekend/weekend.lock`（复用 [v2/scripts/editor/pipeline-status.mjs](../../v2/scripts/editor/pipeline-status.mjs) 的 `acquireProcessLock`，不抢 `sync.lock`）。
- **私有账本与留痕目录（均在仓库外，受 [v2/scripts/lib/repo-containment.mjs](../../v2/scripts/lib/repo-containment.mjs) 保护）**：
  - `C:/Users/teddy/NianlifeOps/weekend-planner/`：`browser-profile/`、`storage-state.json`、`storage-state.backup.json`、`relogin.mjs`、`relogin.cmd`、`raw/<weekId>/`（原始笔记 JSON/截图 PNG、携程截图 JSON）。
  - `C:/Users/teddy/NianlifeOps/ops-daily/state/weekend/`：`weekend.lock`、`run-ledger.json`、`preference-weights.json`、`cooldown-venues.json`、`auth-status.json`、`cache/`、`candidates/<weekId>.json`、`trip-hints/`。

### 5.3 ECS 存储拓扑、无口令写入放行与 `weekend-install`（为何不能复用 `content-install`）

1. **为何必须新增 `weekend-install` 而不能复用 `content-install`？**
   查看 [v2/scripts/deploy-ecs-public.sh](../../v2/scripts/deploy-ecs-public.sh#L229-L283) 与 [v2/lib/month-content.ts](../../v2/lib/month-content.ts#L222-L230)：`content-install` 用 `python3` 硬校验 `schema == "nianlife.month-content/1"` 与 `YYYY-MM` 月报结构、直接写入月稿扫描根目录、占用 `.nianlife-content.lock`，且 `revalidate --scope archive` 不清周末 300s 内存缓存。因此必须新增独立的 `weekend-install` / `weekend-rollback`（锁 `.nianlife-weekend.lock`）及 `/api/internal/revalidate` 的 `scope: "weekend"`。
2. **实读 `ecs-swap.sh` 与 `Caddyfile.ecs` 的基础设施补齐**：
   - **读写子挂载**：`/srv/nianlife-content` 在容器中为 `:ro`（[v2/scripts/deploy-ecs-public.sh](../../v2/scripts/deploy-ecs-public.sh#L44)），且容器运行身份为 UID `1001`（`nextjs`，见 [v2/Dockerfile](../../v2/Dockerfile#L46-L56)）。参照 `HEALTH_MOUNTS` 模式，保持 `/srv/nianlife-content` 及 `weekend/{versions,weeks,current.json}` 为 `:ro`，**单独把 `/srv/nianlife-content/weekend/state` 作为 `:rw` 子挂载**（`chown 1001:1001`、并在 [v2/scripts/ecs-swap.sh](../../v2/scripts/ecs-swap.sh) 接入 `writers()` 单写者保护）；
   - **Caddy 直接放行**：[v2/Caddyfile.ecs](../../v2/Caddyfile.ecs#L82-L86) 默认拦除 GET/HEAD 外所有请求为 405，按 Teddy 偏好新增 `@weekendWrite { method POST; path /api/weekend-state }` 直接反代放行（**不加口令与鉴权拦截**），配合结构枚举检查与目录锁原子落盘。

### 5.4 资源、额度与成本核算（含零实时渲染爬取原则）

- **会话时长**：周一 `8–11m` + 周二 `4–5m` + 周三 `2–3m` + 周五 `1–2m` + 周日 `< 1m` ≈ **全周 `16–22 分钟`**。
- **采集与额度**：每周小红书 `<= 50` 篇（第三轮两阶段补采 27 篇、累计留存 68 篇近 30 天笔记）、携程 `4–6` 家酒店、天气 `~20` 次（`weather.com.cn` 免费直连 `102–208ms` + 周五 4 城坐标 calibrate）；**额外 API 现金成本 0 元/月**。
- **ECS 磁盘**：第三轮含 2026-11-21 三套方案与 68 篇实测溯源的完整示例 `2026-11-21.json` 约 `139 KB`（清单 JSON 约 `150 KB`），状态文件 `< 4 KB`；按每周 2 版本留存，全年 52 周仅占 **`~15 MB`**（相对 ECS 可用空间极轻）。
- **零实时渲染爬取铁律**：Next.js 运行时页面 `/`、`/travel`、`/travel/weekend/[weekId]` **100% 禁止**在请求期间启动 Playwright 或抓取外网，仅读取只读挂载的本地文件并命中 `300s` 进程内内存缓存。
