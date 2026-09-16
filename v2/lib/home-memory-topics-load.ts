// 主题标注缓存的**读取端**，服务端专用（2026-09-16）。
//
// 为什么单独一个文件：`lib/home-memory-topics.ts` 被 `lib/home-memory.ts` 引用，后者又被
// `components/home-memory.tsx`（"use client"）引用。任何 node 依赖放进那条链，都会被拖进
// 客户端打包，构建失败：
//
//   Import trace: node:fs/promises -> ./lib/home-memory-topics.ts
//                 -> ./lib/home-memory.ts -> ./components/home-memory.tsx
//
// 所以类型与纯函数留在那边，**读文件、读环境变量的部分全部在这里**，只给服务端组件用
// （目前只有 app/page.tsx 引用）。另外那份 JSON 有 358KB，也只应该出现在服务端产物里。
import type { PhotoTopicCache } from "@/lib/home-memory-topics";

/** 覆盖缓存路径用（测试与本地实验）。不设就读随仓库发布的那一份。 */
export const HOME_PHOTO_TOPICS_PATH_ENV = "HOME_PHOTO_TOPICS_PATH";

/**
 * 读缓存。默认读随仓库发布的 `data/photo-topics.json`。
 *
 * 任何一步出问题都返回 undefined——首页照样渲染，只是主题回忆不出现
 * （天与季节不受影响，见 lib/home-memory.ts）。不抛错、不写空对象冒充读到了。
 */
export async function loadTopicCache(
  path?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PhotoTopicCache | undefined> {
  try {
    const file = path ?? env[HOME_PHOTO_TOPICS_PATH_ENV];
    if (file) {
      const { readFile } = await import("node:fs/promises");
      return sane(JSON.parse(await readFile(file, "utf8")));
    }
    // 没设路径就读随仓库发布的那一份：走打包器解析，生产上不依赖任何外部路径或环境变量。
    const mod = await import("@/data/photo-topics.json");
    return sane((mod as { default?: unknown }).default ?? mod);
  } catch { return undefined; }
}

/** 缓存自身的形状检查。缺 model / promptVersion 就是「没有可核对的来源」，当读不到处理。 */
function sane(parsed: unknown): PhotoTopicCache | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const cache = parsed as PhotoTopicCache;
  if (!cache.topics || typeof cache.topics !== "object") return undefined;
  if (!cache.model || !cache.promptVersion) return undefined;
  return cache;
}
