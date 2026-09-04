#!/usr/bin/env node
// nianlife-status — 一条命令看清「硬盘上有什么 / 库里有什么 / 线上能读到什么」。
// 只读。不写库、不改文件。CLAUDE.md「完成的定义」的量尺。
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const WECHAT_ROOT = process.env.WECHAT_ROOT || path.join(process.env.HOME || '', 'mnt/WechatHis/texts');
const SITE = process.env.SITE_URL || 'https://nianlife.cn';
const BIRTH = '2025-01-03';
const MONTHS = (() => { const a = []; for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const s = `${y}-${String(m).padStart(2, '0')}`; if (s >= '2025-01' && s <= '2026-09') a.push(s); } return a; })();

function loadEnv(f) {
  const out = {};
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function bar(n, max, w = 24) {
  if (!max) return '';
  return '█'.repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * w)));
}

// ---------- 硬盘 ----------
function scanDisk() {
  const convos = [];
  if (!fs.existsSync(WECHAT_ROOT)) return convos;
  for (const dir of fs.readdirSync(WECHAT_ROOT)) {
    const full = path.join(WECHAT_ROOT, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    const md = fs.readdirSync(full).find((f) => f.endsWith('.md'));
    if (!md) { convos.push({ name: dir, total: 0, since: 0, months: {}, note: '无 Markdown' }); continue; }
    const text = fs.readFileSync(path.join(full, md), 'utf8');
    const months = {};
    let total = 0, since = 0;
    for (const m of text.matchAll(/^## (\d{4})\\?-(\d{2})\\?-(\d{2}) /gm)) {
      total++;
      const day = `${m[1]}-${m[2]}-${m[3]}`;
      if (day >= BIRTH) { since++; const k = `${m[1]}-${m[2]}`; months[k] = (months[k] || 0) + 1; }
    }
    convos.push({ name: dir, total, since, months });
  }
  return convos.sort((a, b) => b.since - a.since);
}

// ---------- 库 ----------
async function queryDb(client) {
  const one = async (sql, args = []) => (await client.query(sql, args)).rows;
  const counts = {};
  for (const t of ['raw_sources', 'media_assets', 'media', 'life_events', 'daily_traces', 'organizer_runs', 'organizer_jobs', 'content_quality_reviews', 'chat_import_tasks', 'source_memory_links']) {
    counts[t] = Number((await one(`select count(*) c from ${t}`))[0].c);
  }
  const byMonth = async (table, col) =>
    Object.fromEntries((await one(
      `select to_char(${col},'YYYY-MM') m, count(*) c from ${table} where ${col} is not null group by 1`
    )).map((r) => [r.m, Number(r.c)]));

  return {
    counts,
    raw: await byMonth('raw_sources', 'captured_at'),
    assets: await byMonth('media_assets', 'taken_at'),
    events: await byMonth('life_events', 'occurred_at'),
    traces: await byMonth('daily_traces', 'occurred_at'),
    labels: await one(`select coalesce(source_label,'(null)') label, count(*) c,
                              to_char(min(captured_at),'YYYY-MM') lo, to_char(max(captured_at),'YYYY-MM') hi
                       from raw_sources group by 1 order by 2 desc`),
    archive: await one(`select archive_status s, count(*) c from media_assets group by 1 order by 2 desc`),
    reviews: await one(`select target_kind k, decision d, count(*) c from content_quality_reviews group by 1,2 order by 1,3 desc`),
    tasks: await one(`select id, status, phase, processed_messages, created_messages, current_stage,
                             to_char(updated_at,'YYYY-MM-DD') as upd
                      from chat_import_tasks order by updated_at desc limit 8`),
  };
}

// ---------- 线上 ----------
async function checkSite() {
  const t0 = Date.now();
  let res;
  try { res = await fetch(SITE, { signal: AbortSignal.timeout(20000) }); }
  catch (e) { return { error: String(e.message || e) }; }
  const html = await res.text();
  const ms = Date.now() - t0;
  const days = [...html.matchAll(/(20\d\d)[-年](\d\d?)[-月](\d\d?)/g)].map((m) => `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`);
  const months = [...html.matchAll(/(20\d\d)\s*年\s*(\d\d?)\s*月/g)].map((m) => `${m[1]}-${String(m[2]).padStart(2, '0')}`);
  const all = [...days, ...months.map((m) => m + '-01')].sort();
  return { status: res.status, ms, bytes: html.length, latest: all.at(-1) || null, imgs: (html.match(/<img/g) || []).length };
}

// ---------- 输出 ----------
(async () => {
  const env = loadEnv(path.join(process.cwd(), '.env.local'));
  const url = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!url) { console.error('缺少 DATABASE_URL（在 v2/ 下运行，或设环境变量）'); process.exit(1); }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const disk = scanDisk();
  const db = await queryDb(client);
  await client.end();
  const site = await checkSite();

  const P = console.log;
  P(`\n=== nianlife 状态 · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC ===\n`);

  P('【表计数】');
  P(Object.entries(db.counts).map(([k, v]) => `${k}=${v}`).join('  '));
  P('归档: ' + db.archive.map((r) => `${r.s}=${r.c}`).join('  '));
  P('');

  P('【月度覆盖】 raw = 文字/消息, 图 = media_assets, 事 = life_events, 痕 = daily_traces');
  const maxRaw = Math.max(...MONTHS.map((m) => db.raw[m] || 0), 1);
  let holes = [];
  for (const m of MONTHS) {
    const r = db.raw[m] || 0, a = db.assets[m] || 0, e = db.events[m] || 0, t = db.traces[m] || 0;
    const diskHas = disk.some((c) => c.months[m]);
    if (r === 0 && a === 0) holes.push(m + (diskHas ? '(硬盘有!)' : ''));
    P(`${m}  raw ${String(r).padStart(5)} ${bar(r, maxRaw).padEnd(24)} 图${String(a).padStart(5)} 事${String(e).padStart(3)} 痕${String(t).padStart(4)}${diskHas && r === 0 ? '   ← 硬盘上有，库里没有' : ''}`);
  }
  P('');
  P(holes.length ? `空月份 (${holes.length}): ${holes.join(', ')}` : '✅ 每个月都有内容');
  P('');

  P('【硬盘 vs 入库】(硬盘按出生日 ' + BIRTH + ' 起算)');
  for (const c of disk) {
    const ms = Object.keys(c.months).sort();
    P(`  ${c.name}`);
    P(`     硬盘 ${String(c.since).padStart(6)} 条 (全量 ${c.total})  ${ms[0] || '-'} → ${ms.at(-1) || '-'}  跨 ${ms.length} 个月${c.note ? '  ' + c.note : ''}`);
  }
  P('  ── 库中 source_label 分布 ──');
  for (const r of db.labels) P(`     ${String(r.c).padStart(6)} 条  ${r.lo} → ${r.hi}  ${r.label}`);
  const diskTotal = disk.reduce((s, c) => s + c.since, 0);
  P(`  合计: 硬盘 ${diskTotal} 条 / 库 ${db.counts.raw_sources} 条 = ${(100 * db.counts.raw_sources / (diskTotal || 1)).toFixed(1)}%`);
  P('');

  P('【导入任务】');
  for (const t of db.tasks) P(`  ${t.upd}  ${t.status}/${t.phase || '-'}  stage=${t.current_stage || '-'}  processed=${t.processed_messages} created=${t.created_messages}`);
  P('');

  P('【质量审阅】');
  for (const r of db.reviews) P(`  ${r.k.padEnd(12)} ${r.d.padEnd(18)} ${r.c}`);
  P('');

  P('【线上 ' + SITE + '】');
  if (site.error) P('  ✗ ' + site.error);
  else P(`  HTTP ${site.status}  ${site.ms}ms  ${(site.bytes / 1024).toFixed(0)}KB  <img> ${site.imgs}  首页最新日期: ${site.latest || '未识别'}`);
  P('');
})();
