// 微信导出的「规范输入」选择与重复导出判定。
//
// 背景：WeFlow 按会话目录导出，群改名后会再导出一份，目录名不同但 session.wxid 相同。
// 同一会话还可能同时存在 .json 与 .md 两种格式。两种情况都会把同一批消息重复计数。
//
// 规则（不删原件，只标状态）：
//   1. 会话身份 = session.wxid。群名不是身份，目录名也不是。
//      **消息身份必须带上会话身份**——不同会话的消息 ID 空间互不相干，
//      两个群里 platformMessageId 恰好相同的两条消息是两条消息，不是一条。
//   2. localId 是「某个会话在某台设备本地库里的行号」，**只在同一会话内有效**，
//      跨会话没有意义，因此只作会话内的兜底键，且标记为弱身份。
//   3. 同一 wxid 的多份导出，只有在**能够证明完整包含**时才判 superseded：
//      对方含有本份的全部可识别消息，且本份没有无法识别的消息，且共有消息的内容指纹一致。
//      证明不了就保留两份，交人工，**绝不丢消息**。
//   4. 同一消息 ID 而内容/附件变了（撤回后重编辑、导出器版本差异）不算同一条内容，
//      标为 content_divergent，保留两个版本或明确说明选了哪个。
//   5. 同一会话 JSON 与 Markdown 并存时，JSON 为规范输入（有消息级 ID 可去重），
//      Markdown 标 secondary_format，不重复计数。只有 Markdown 时 Markdown 就是规范输入。
//
// 纯函数，不读盘、不联网，供导入与盘点复用。

/** 空串、纯空白、"null"/"undefined" 字面量都不算有效 ID。 */
function usableId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "" || s === "null" || s === "undefined") return null;
  return s;
}

/**
 * 会话内的消息身份。**必须传会话身份**，否则跨会话会误合并。
 * @returns {{key:string,id:string,idKind:"platform"|"local",strength:"strong"|"weak"}|null}
 *          返回 null 表示这条消息无法识别身份（不能用于证明包含关系，也不能去重）。
 */
export function messageIdentity(message, conversationId) {
  if (conversationId == null || String(conversationId).trim() === "") {
    throw new Error("messageIdentity 需要会话身份：不同会话的消息 ID 空间互不相干");
  }
  const platform = usableId(message?.platformMessageId);
  const local = usableId(message?.localId);
  const idKind = platform ? "platform" : local ? "local" : null;
  if (!idKind) return null;
  const id = platform ?? `local:${local}`;
  const time = message?.createTime ?? "";
  return {
    key: `${conversationId}::${idKind}:${id}@${time}`,
    id,
    idKind,
    // localId 只在同一会话内可靠：换台设备/重装后会重排
    strength: idKind === "platform" ? "strong" : "weak",
  };
}

/** 内容指纹：同一 ID 下内容或附件变了要能看出来。不含 ID 与导出器元数据。 */
export function contentFingerprint(message) {
  const parts = [
    message?.type ?? "",
    message?.localType ?? "",
    message?.content ?? "",
    message?.senderUsername ?? "",
    message?.mediaPath ?? message?.filePath ?? "",
    message?.emojiMd5 ?? "",
  ];
  return parts.join("\u0001");
}

// 导出器在媒体还没落盘时会写 `[视频]` 这类占位符，落盘后才写相对路径。
const PLACEHOLDER = /^\[(视频|图片|语音|动画表情|表情|文件|位置|音乐|链接|卡片)\]$/;
const MEDIA_PATH = /[\\/].+\.[A-Za-z0-9]{2,5}$/;

/**
 * 判断同 ID 两条消息的差异性质：是同一条消息的**附件落盘程度**不同，
 * 还是内容真的变了。前者可以明确选版本，后者必须人工决定。
 * @returns {"attachment_resolved_in_a"|"attachment_resolved_in_b"|"content_changed"}
 */
export function classifyDivergence(aMessage, bMessage) {
  const a = String(aMessage?.content ?? "");
  const b = String(bMessage?.content ?? "");
  const sameShell =
    (aMessage?.type ?? "") === (bMessage?.type ?? "") &&
    (aMessage?.localType ?? "") === (bMessage?.localType ?? "") &&
    (aMessage?.senderUsername ?? "") === (bMessage?.senderUsername ?? "");
  if (sameShell && PLACEHOLDER.test(b) && MEDIA_PATH.test(a)) return "attachment_resolved_in_a";
  if (sameShell && PLACEHOLDER.test(a) && MEDIA_PATH.test(b)) return "attachment_resolved_in_b";
  return "content_changed";
}

/**
 * 比较同一会话（同 conversationId）的两份导出。
 * @returns {{
 *   verdict:"a_contains_b"|"b_contains_a"|"identical"|"content_divergent"|"overlapping"|"disjoint",
 *   shared:number, aOnly:number, bOnly:number,
 *   aUnidentified:number, bUnidentified:number,
 *   divergentKeys:string[],
 *   containmentProvable:boolean
 * }}
 */
export function compareExports(aMessages, bMessages, conversationId) {
  // 同一份导出里可能出现同键不同内容（撤回后重编辑、导出器重复写入）。
  // 用 Map<key, 消息数组> 而不是 Map<key, 消息>，否则后写的会**悄悄覆盖**前一个版本，
  // 导致「对方少了一个版本」也被判成 identical。
  const index = (msgs) => {
    const map = new Map();
    let unidentified = 0;
    for (const m of msgs) {
      const ident = messageIdentity(m, conversationId);
      if (!ident) { unidentified += 1; continue; }
      if (!map.has(ident.key)) map.set(ident.key, []);
      map.get(ident.key).push(m);
    }
    return { map, unidentified };
  };
  const a = index(aMessages);
  const b = index(bMessages);
  const versions = (side, k) => new Set((side.map.get(k) ?? []).map(contentFingerprint));

  const divergences = [];
  let shared = 0;
  // b 的每一个版本都必须在 a 里找得到，否则就是 a 缺版本
  for (const [k, bms] of b.map) {
    if (!a.map.has(k)) continue;
    shared += 1;
    const av = versions(a, k);
    const bv = versions(b, k);
    const missingInA = [...bv].filter((fp) => !av.has(fp));
    const missingInB = [...av].filter((fp) => !bv.has(fp));
    if (missingInA.length === 0 && missingInB.length === 0) continue;
    // 只有「双方各恰好一个版本」时才谈附件落盘那种版本升级；多版本一律按内容改动处理
    const kind = (av.size === 1 && bv.size === 1)
      ? classifyDivergence(a.map.get(k)[0], bms[0])
      : "content_changed";
    divergences.push({
      key: k, kind,
      versionsInA: av.size, versionsInB: bv.size,
      versionsMissingInA: missingInA.length, versionsMissingInB: missingInB.length,
    });
  }
  const aOnly = a.map.size - shared;
  const bOnly = b.map.size - shared;
  const contentChanged = divergences.filter((d) => d.kind === "content_changed");
  // a 侧附件更全 = a 严格更完整，这种分歧不阻止「a 包含 b」，但要留版本说明
  const resolvedInB = divergences.filter((d) => d.kind === "attachment_resolved_in_b");
  // a 里缺了 b 有的版本 → a 不可能包含 b，无论差异属于哪一类
  const aMissesVersion = divergences.some((d) => d.versionsMissingInA > 0 && d.kind !== "attachment_resolved_in_a");
  const base = {
    shared, aOnly, bOnly,
    aUnidentified: a.unidentified, bUnidentified: b.unidentified,
    divergences,
    divergentKeys: divergences.map((d) => d.key),
  };

  if (shared === 0 && a.map.size + b.map.size > 0) {
    return { ...base, verdict: "disjoint", containmentProvable: false };
  }
  // 真正的内容改动、或 a 缺了 b 的某个版本：不能当成同一条消息悄悄合并
  if (contentChanged.length > 0 || resolvedInB.length > 0 || aMissesVersion) {
    return { ...base, verdict: "content_divergent", containmentProvable: false };
  }
  // 无法识别身份的消息 = 无法证明它已经在对方那份里 → 不允许判包含
  const bProvablyInside = bOnly === 0 && b.unidentified === 0;
  const aProvablyInside = aOnly === 0 && a.unidentified === 0 && divergences.length === 0;
  if (aProvablyInside && bProvablyInside) {
    return { ...base, verdict: "identical", containmentProvable: true };
  }
  if (bProvablyInside) return { ...base, verdict: "a_contains_b", containmentProvable: true };
  if (aProvablyInside) return { ...base, verdict: "b_contains_a", containmentProvable: true };
  return { ...base, verdict: "overlapping", containmentProvable: false };
}

/**
 * 为一组导出选规范输入并标状态。
 * @param {Array<{dir:string,file:string,format:"json"|"md",wxid:string|null,messages:Array}>} exports_
 */
export function selectCanonical(exports_) {
  const out = exports_.map((e) => ({ ...e, status: "canonical", canonical: true, reason: "", notes: [] }));
  const groups = new Map();
  for (const e of out) {
    // wxid 缺失时退回目录名：身份不明的两份不得互相压制
    const key = usableId(e.wxid) ? `wxid:${String(e.wxid).trim()}` : `dir:${e.dir}`;
    e._convKey = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  for (const [convKey, group] of groups) {
    // 规则 5：格式优先，**但只对已证明是同批格式副本的 Markdown 生效**。
    // 「同一会话已有 JSON」不等于那份 JSON 覆盖了 Markdown 的全部消息——
    // Markdown 可能来自另一次导出、含 JSON 没有的独有消息（不同时间窗、增量导出）。
    // 证明不了包含就保留为 canonical，交人工，绝不因为格式就丢内容。
    const json = group.filter((e) => e.format === "json");
    if (json.length > 0) {
      for (const e of group) {
        if (e.format === "json") continue;
        // 必须是「JSON 包含 Markdown」这个方向；反向包含说明 Markdown 更全，不能压制它
        const covering = json.find((j) => {
          const cmp = compareExports(j.messages, e.messages, convKey);
          return cmp.containmentProvable
            && (cmp.verdict === "a_contains_b" || cmp.verdict === "identical");
        });
        if (covering) {
          e.status = "secondary_format";
          e.canonical = false;
          e.supersededBy = covering.dir;
          e.reason = `全部消息均可在同会话的 JSON 导出 ${covering.dir} 中定位，判为同批格式副本，不重复计数`;
        } else {
          e.status = "format_variant_unverified";
          e.reason = "同会话虽有 JSON 导出，但**未能证明**本 Markdown 的消息已被完整包含"
            + "（可能是不同导出批次或含独有消息），保留待人工判定，不按格式副本压制";
        }
      }
    }

    // 规则 3/4：同格式多份之间比消息集合。
    // 先定包含关系（谁被压制），再给仍然并存的几份贴分歧标签——
    // 否则超集自己会被反向比较的「对方附件更全」标成分歧。
    const rivals = json.length > 0 ? json : group;
    const ordered = [...rivals].sort((x, y) => (y.messages.length - x.messages.length) || (x.dir < y.dir ? -1 : 1));

    for (const e of ordered) {
      if (!e.canonical) continue;
      for (const other of ordered) {
        if (other === e || !other.canonical) continue;
        const cmp = compareExports(other.messages, e.messages, convKey);
        if (cmp.verdict !== "a_contains_b" && cmp.verdict !== "identical") continue;
        // identical 时保留排序靠前的那份，另一份标 superseded
        if (cmp.verdict === "identical" && ordered.indexOf(other) > ordered.indexOf(e)) continue;
        const upgraded = cmp.divergences.filter((d) => d.kind === "attachment_resolved_in_a").length;
        e.status = "superseded";
        e.canonical = false;
        e.supersededBy = other.dir;
        e.reason = cmp.verdict === "identical"
          ? `与 ${other.dir} 消息集合与内容指纹完全一致（同一会话重复导出）`
          : `全部 ${cmp.shared} 条可识别消息均包含于 ${other.dir}，且本份无不可识别消息（同一会话重复导出）`;
        if (upgraded > 0) {
          e.reason += `；另有 ${upgraded} 条媒体消息在本份仍是占位符、在 ${other.dir} 已落盘为文件路径，选后者为版本`;
          e.notes.push({ against: other.dir, attachmentResolvedInCanonical: upgraded });
        }
        break;
      }
    }

    const survivors = ordered.filter((e) => e.canonical);
    if (survivors.length > 1) {
      for (const e of survivors) {
        for (const other of survivors) {
          if (other === e) continue;
          const cmp = compareExports(other.messages, e.messages, convKey);
          if (cmp.verdict === "content_divergent") {
            e.status = "content_divergent";
            e.reason = `与 ${other.dir} 有 ${cmp.divergences.length} 条同 ID 但内容/附件不同，两份都保留待人工选版本`;
            e.notes.push({ against: other.dir, divergent: cmp.divergences.length });
          } else if (cmp.verdict === "overlapping" && e.status === "canonical") {
            const why = cmp.bUnidentified > 0
              ? `本份有 ${cmp.bUnidentified} 条消息缺少可用 ID，无法证明已被 ${other.dir} 完整包含`
              : `与 ${other.dir} 部分重叠，任何一份都不是超集`;
            e.status = "overlapping";
            e.reason = `${why}，两份都保留待人工判定`;
          }
        }
      }
    }
  }
  return out.map(({ _convKey, ...rest }) => rest);
}

/**
 * 规范输入的去重消息数。
 * 无法识别身份的消息不能去重，单独计数并如实报告，不并入去重总数、也不悄悄丢弃。
 * @returns {{identified:number, unidentified:number, total:number}}
 */
export function countDistinctMessages(selection) {
  const seen = new Set();
  let unidentified = 0;
  for (const e of selection) {
    if (!e.canonical) continue;
    const convKey = usableId(e.wxid) ? `wxid:${String(e.wxid).trim()}` : `dir:${e.dir}`;
    for (const m of e.messages) {
      const ident = messageIdentity(m, convKey);
      if (ident) seen.add(ident.key);
      else unidentified += 1;
    }
  }
  return { identified: seen.size, unidentified, total: seen.size + unidentified };
}
