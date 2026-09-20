// HEALTH-01 起用：微信导出的「规范输入」选择与重复导出判定。
//
// 背景：WeFlow 按会话目录导出，群改名后会再导出一份，目录名不同但 session.wxid 相同。
// 同一会话还可能同时存在 .json 与 .md 两种格式。两种情况都会把同一批消息重复计数。
//
// 规则（不删原件，只标状态）：
//   1. 会话身份 = session.wxid（群名不是身份，目录名也不是）。
//   2. 同一 wxid 的多份导出，按消息集合比较：真子集 → superseded；否则 → overlapping（需人工看）。
//   3. 同一会话 JSON 与 Markdown 并存时，JSON 为规范输入（有消息级 ID 可去重），
//      Markdown 标 secondary_format，不重复计数。
//   4. 只有 Markdown 的会话，Markdown 就是规范输入。
//
// 纯函数，不读盘、不联网，供导入与盘点复用。

/** 消息去重键。platformMessageId 可能缺失，退回 localId。 */
export function messageKey(m) {
  const id = m?.platformMessageId ?? (m?.localId == null ? null : `local:${m.localId}`);
  if (id == null) return null;
  return `${id}@${m?.createTime ?? ""}`;
}

/**
 * 比较同一 wxid 的两份导出。
 * @returns {"a_superset"|"b_superset"|"identical"|"overlapping"|"disjoint"}
 */
export function compareExports(aMessages, bMessages) {
  const a = new Set(aMessages.map(messageKey).filter(Boolean));
  const b = new Set(bMessages.map(messageKey).filter(Boolean));
  let shared = 0;
  for (const k of b) if (a.has(k)) shared += 1;
  if (shared === 0) return "disjoint";
  if (shared === a.size && shared === b.size) return "identical";
  if (shared === b.size) return "a_superset";
  if (shared === a.size) return "b_superset";
  return "overlapping";
}

/**
 * 为一组导出选规范输入并标状态。
 * @param {Array<{dir:string,file:string,format:"json"|"md",wxid:string|null,messages:Array}>} exports_
 * @returns {Array<{dir,file,format,wxid,status,canonical:boolean,reason:string,supersededBy?:string}>}
 */
export function selectCanonical(exports_) {
  const out = exports_.map((e) => ({ ...e, status: "canonical", canonical: true, reason: "" }));
  const byWxid = new Map();
  for (const e of out) {
    // wxid 缺失时退回目录名，避免把身份不明的两份误判为同一会话
    const key = e.wxid ?? `dir:${e.dir}`;
    if (!byWxid.has(key)) byWxid.set(key, []);
    byWxid.get(key).push(e);
  }

  for (const [, group] of byWxid) {
    // 3/4：格式优先，JSON 压过 Markdown
    const json = group.filter((e) => e.format === "json");
    if (json.length > 0) {
      for (const e of group) {
        if (e.format !== "json") {
          e.status = "secondary_format";
          e.canonical = false;
          e.reason = "同一会话已有 JSON 导出，Markdown 不重复计数";
        }
      }
    }

    // 2：同格式多份导出之间比消息集合
    const rivals = json.length > 0 ? json : group;
    for (const e of rivals) {
      for (const other of rivals) {
        if (e === other || !e.canonical) continue;
        const verdict = compareExports(other.messages, e.messages);
        if (verdict === "a_superset" || (verdict === "identical" && other.messages.length >= e.messages.length && other.dir < e.dir)) {
          e.status = "superseded";
          e.canonical = false;
          e.supersededBy = other.dir;
          e.reason =
            verdict === "identical"
              ? `与 ${other.dir} 消息集合完全相同（同一会话重复导出）`
              : `全部 ${e.messages.length} 条消息均包含于 ${other.dir}（同一会话，群名变更后重复导出）`;
        } else if (verdict === "overlapping" && e.canonical) {
          e.status = "overlapping";
          e.reason = `与 ${other.dir} 部分重叠，任何一份都不是超集，需人工判定`;
        }
      }
    }
  }
  return out;
}

/** 规范输入的消息总数（重复导出只计一次）。 */
export function countDistinctMessages(selection) {
  const seen = new Set();
  for (const e of selection) {
    if (!e.canonical) continue;
    for (const m of e.messages) {
      const k = messageKey(m);
      if (k) seen.add(k);
    }
  }
  return seen.size;
}
