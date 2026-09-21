// One HealthPageService per process for the /health page (the API route builds its own through createHealthRecordHandler).
// Off unless HEALTH_RECORD_* is configured; the history ledger, intervals and materials are optional extra inputs.
import { loadHealthRecordConfig, type HealthRecordConfig } from "../record/config";
import { HealthRecordService } from "../record/service";
import { HealthPageService, loadPageSourcesConfig } from "./service";

let current: { key: string; page: HealthPageService } | null = null;

export function healthPageRuntime(): { ok: true; config: HealthRecordConfig; page: HealthPageService } | { ok: false; reason: string } {
  const conf = loadHealthRecordConfig();
  if (!conf.ok) return { ok: false, reason: conf.reason };
  const sources = loadPageSourcesConfig(conf.config.repo);
  const key = `${conf.config.root}|${JSON.stringify(sources)}`;
  if (!current || current.key !== key) current = { key, page: new HealthPageService(new HealthRecordService(conf.config.root, { repo: conf.config.repo }), sources) };
  return { ok: true, config: conf.config, page: current.page };
}
