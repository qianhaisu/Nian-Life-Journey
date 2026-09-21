// HTTP surface of the HEALTH-03 record feature: one dispatcher over the standard Request/Response types
// (mounted by app/api/health-record/[...path]/route.ts; tests call it directly).
// Every response is private and uncacheable. Reads need a valid session; writes also need a same-origin Origin header.
import { clearCookie, issueSession, LoginBrake, passwordMatches, readSession, sameOrigin, type Session } from "./auth";
import { loadHealthRecordConfig, type ConfigResult, type HealthRecordConfig, type HealthWho } from "./config";
import { IMAGE_LIMITS, inspectImage, RecordError, type InspectedImage } from "./media";
import { HealthRecordService, type ServiceOptions } from "./service";
import { HealthPageService, loadPageSourcesConfig, type PageSourcesConfig } from "../page/service";

const HEADERS = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", Vary: "Cookie", "Referrer-Policy": "no-referrer" };
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra } });
const fail = (e: RecordError) => json(e.status, { ok: false, code: e.code, message: e.message, ...e.extra });

export function createHealthRecordHandler(getConfig: () => ConfigResult = () => loadHealthRecordConfig(), serviceOpts: () => ServiceOptions = () => ({}), pageSources: (cfg: HealthRecordConfig) => PageSourcesConfig = (cfg) => loadPageSourcesConfig(cfg.repo)) {
  const brake = new LoginBrake();
  let svc: { root: string; service: HealthRecordService } | null = null;
  const serviceFor = (cfg: HealthRecordConfig) => (svc && svc.root === cfg.root ? svc.service : (svc = { root: cfg.root, service: new HealthRecordService(cfg.root, { repo: cfg.repo, ...serviceOpts() }) }).service);
  let pages: { key: string; page: HealthPageService } | null = null;
  const pageFor = (cfg: HealthRecordConfig) => {
    const sources = pageSources(cfg), key = `${cfg.root}|${JSON.stringify(sources)}`;
    if (!pages || pages.key !== key) pages = { key, page: new HealthPageService(serviceFor(cfg), sources, serviceOpts().now) };
    return pages.page;
  };

  return async function handle(req: Request, segments: string[]): Promise<Response> {
    const conf = getConfig();
    if (!conf.ok) return json(404, { ok: false, code: "disabled", message: "健康记录没有启用。" });
    const cfg = conf.config;
    const method = req.method.toUpperCase();
    const write = method !== "GET" && method !== "HEAD";
    try {
      if (write && !sameOrigin(cfg, req)) return json(403, { ok: false, code: "cross_origin", message: "请求来源不正确。" });
      const [a, b, c] = segments;

      if (a === "session") {
        if (method === "POST") {
          const body = (await readJson(req)) as { who?: string; password?: string };
          const who = body.who;
          if ((who !== "mom" && who !== "dad") || typeof body.password !== "string") return json(400, { ok: false, code: "invalid", message: "请选择妈妈或爸爸，并输入密码。" });
          if (brake.blocked(who)) return json(429, { ok: false, code: "too_many_attempts", message: "试得太多次了，请过几分钟再试。" });
          if (!passwordMatches(cfg, who, body.password)) { brake.fail(who); return json(401, { ok: false, code: "bad_credentials", message: "密码不对。" }); }
          brake.ok(who);
          const s = issueSession(cfg, who);
          return json(200, { ok: true, who, label: who === "mom" ? "妈妈" : "爸爸" }, { "Set-Cookie": s.setCookie });
        }
        if (method === "DELETE") return json(200, { ok: true }, { "Set-Cookie": clearCookie(cfg) });
        if (method === "GET") { const s = readSession(cfg, req.headers.get("cookie")); return s ? json(200, { ok: true, who: s.who, label: s.label }) : json(401, { ok: false, code: "unauthenticated", message: "请先登录。" }); }
        return json(405, { ok: false, code: "method", message: "不支持这个操作。" });
      }

      const session: Session | null = readSession(cfg, req.headers.get("cookie"));
      if (!session) return json(401, { ok: false, code: "unauthenticated", message: "请先登录。" });
      const service = serviceFor(cfg);

      if (a === "entries" && !b) {
        if (method === "GET") {
          const u = new URL(req.url);
          return json(200, { ok: true, ...(await service.list({ cursor: u.searchParams.get("cursor"), limit: Number(u.searchParams.get("limit")) || undefined })) });
        }
        if (method === "POST") return json(200, { ok: true, ...(await create(service, session.who, req)) });
      }
      if (a === "entries" && b && !c && method === "GET") {
        const d = await service.detail(decodeURIComponent(b));
        return d ? json(200, { ok: true, ...d }) : json(404, { ok: false, code: "not_found", message: "找不到这条记录。" });
      }
      if (a === "entries" && b && c === "corrections" && method === "POST") return json(200, { ok: true, ...(await service.correct(session.who, decodeURIComponent(b), (await readJson(req)) as Record<string, unknown>)) });
      if (a === "entries" && b && c === "attribution" && method === "POST") return json(200, { ok: true, ...(await service.setAttribution(session.who, decodeURIComponent(b), (await readJson(req)) as Record<string, unknown>)) });
      // HEALTH-04: health reminders for the home page (explicit appointments only) and hospital originals from the history ledger
      if (a === "reminders" && !b && method === "GET") return json(200, { ok: true, items: (await pageFor(cfg).page()).reminders });
      if (a === "history-originals" && b && !c && method === "GET") {
        const f = await pageFor(cfg).historyOriginal(decodeURIComponent(b));
        if (!f) return json(404, { ok: false, code: "not_found", message: "找不到这份原件。" });
        return new Response(new Uint8Array(f.data), { status: 200, headers: { ...HEADERS, "Content-Type": f.mime, "Content-Disposition": "inline", "Content-Length": String(f.data.length) } });
      }
      if (a === "originals" && b && method === "GET") {
        const thumb = new URL(req.url).searchParams.get("thumb") === "1";
        const f = await service.readOriginal(b, thumb);
        if (!f) return json(404, { ok: false, code: "not_found", message: "找不到这张图片。" });
        return new Response(new Uint8Array(f.data), { status: 200, headers: { ...HEADERS, "Content-Type": f.mime, "Content-Disposition": "inline", "Content-Length": String(f.data.length) } });
      }
      return json(404, { ok: false, code: "not_found", message: "没有这个入口。" });
    } catch (e) {
      if (e instanceof RecordError) return fail(e);
      return json(500, { ok: false, code: "server_error", message: "服务出错了，请稍后重试。" });
    }
  };
}

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 256 * 1024) throw new RecordError(413, "too_large", "请求太大了。");
  try { const v = await req.json(); return typeof v === "object" && v !== null ? v : {}; } catch { throw new RecordError(400, "invalid", "请求格式不正确。"); }
}

async function create(service: HealthRecordService, who: HealthWho, req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    if (Number(req.headers.get("content-length") ?? 0) > IMAGE_LIMITS.maxTotalBytes + 1024 * 1024) throw new RecordError(413, "image_too_large", `图片总大小不能超过 ${IMAGE_LIMITS.maxTotalBytes / 1048576} MB。`);
    let form: FormData;
    try { form = await req.formData(); } catch { throw new RecordError(400, "invalid", "上传内容格式不正确。"); }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { throw new RecordError(400, "invalid", "请求格式不正确。"); }
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (files.length > IMAGE_LIMITS.maxFiles) throw new RecordError(400, "too_many_images", `一次最多传 ${IMAGE_LIMITS.maxFiles} 张图片。`);
    if (payload.type !== "visit" && files.length) throw new RecordError(400, "invalid", "只有就医记录可以带图片。");
    let total = 0;
    const images: InspectedImage[] = [];
    for (const f of files) { total += f.size; if (total > IMAGE_LIMITS.maxTotalBytes) throw new RecordError(413, "image_too_large", `图片总大小不能超过 ${IMAGE_LIMITS.maxTotalBytes / 1048576} MB。`); images.push(await inspectImage(f.name, Buffer.from(await f.arrayBuffer()))); }
    return payload.type === "visit" ? service.createVisit(who, payload, images) : service.createNote(who, payload);
  }
  const payload = (await readJson(req)) as Record<string, unknown>;
  if (payload.type === "visit") return service.createVisit(who, payload, []);
  if (payload.type === "note") return service.createNote(who, payload);
  throw new RecordError(400, "invalid", "记录类型不正确。");
}
