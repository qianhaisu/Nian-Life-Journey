# 月份跳转客户端异常修复

用户报告：点击 `/memory/2026/09` 偶发 Application error，刷新恢复。

## 复现证据

新浏览器连续三次从 `/memory` 点击九月正常。使用保留的 9cae65e 版本年度页面与预加载的九月 RSC 响应，在浏览器测试中模拟旧页面跨发布继续使用缓存，九月跳转稳定出现同样的 Application error：旧月份脚本 `page-9c102efa7f28d8c7.js` 已不在当前服务，HTTP 404 导致 `ChunkLoadError: Loading chunk 997 failed`。测试只替换本地浏览器收到的响应，没有改线上数据。用户设备的原始控制台日志未取得，因此这是已复现的匹配故障机制，不代表排除了其他客户端异常。

## 修复

- 应用错误边界识别脚本/CSS chunk 加载失败，自动重新打开当前 URL 一次，清除旧 Router 预加载状态。
- 同一 URL 的一分钟内最多自动恢复一次，先写 sessionStorage 再刷新；存储不可用时只提供手动重试，普通渲染错误不会触发自动刷新。
- 非自动恢复情况显示中文重试入口，保留回到记忆的入口，不展示内部报错细节。
- Docker 构建阶段传入发布 SHA 作为 Next.js deploymentId；应用代码、静态资源请求对应同一发布标识。
- 不改变月份内容、照片、妈妈月报或数据库。

## 验证

`test/chunk-recovery.test.mjs` 覆盖重试节流、普通异常和受限存储；`test/chunk-recovery.browser.mjs` 在浏览器中注入过期月份脚本，要求仅发生一次文档重载并恢复月份页面。浏览器测试通过 APP_BASE_URL 指向目标，TEST_MONTH_PATH 可指定月份。

旧标签页在首次载入修复版之前尚无新错误边界；这种页面可能仍需最后一次手动刷新。修复不会伪装成能远程更新已下载的旧 JavaScript。
