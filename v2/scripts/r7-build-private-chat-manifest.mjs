/**
 * Build a wechat-import-all manifest for the Ted-苏静 private chat prenatal messages.
 * Selects NT scan (Jun 2024), US prenatal (Dec 2024) messages and computes canonical IDs.
 * Output: R7-PRIVATE-CHAT-MANIFEST.json in NianlifeOps artifacts dir.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const PRIVATE_CHAT_PATH = "E:\\WechatHis\\texts\\私聊_阿静-341ea5e49d\\私聊_阿静-341ea5e49d.md";
const SOURCE_ROOT = "E:\\WechatHis";
const DOC_RELATIVE = "texts/私聊_阿静-341ea5e49d/私聊_阿静-341ea5e49d.md";
const OUT_PATH = "C:/Users/teddy/Documents/NianlifeOps/artifacts/NIGHT-RELATIONS-20260921/R7-PRIVATE-CHAT-MANIFEST.json";

// Curated ordinals for meaningful prenatal messages
// June 2024: NT scan preparation, hospital visit, results
// Nov-Dec 2024: US prenatal visit planning, health checks, accommodation, Dec 4 visit
const SELECTED_ORDINALS = new Set([
  // June 2024 — NT scan anticipation & announcement
  57830, 57831, 57838, 57841,
  // June 2024 — going to hospital day
  58039, 58116, 58129, 58130, 58270, 58275,
  // July 2024 — NT results, next steps
  58914, 58917,
  // Nov 2024 — US birth planning, 张年 first named
  64785, 64789, 64819, 64820,
  // Nov 2024 — vitamin D concern, health
  64708, 64725, 64739,
  // Nov 2024 — equipment secured for US
  65161, 65046,
  // Nov 2024 — late pregnancy checks
  66092, 66118, 66146, 66147, 66158,
  // Nov 2024 — accommodation planning
  66022,
  // Dec 2024 — first US prenatal visit
  66255, 66258,
]);

// Parse the markdown file
const { parseWechatMarkdown } = await import("../lib/ingest/wechat-markdown.ts");

if (!existsSync(PRIVATE_CHAT_PATH)) {
  console.error(`File not found: ${PRIVATE_CHAT_PATH}`);
  process.exit(1);
}

const text = readFileSync(PRIVATE_CHAT_PATH, "utf8");
const fileSha256 = createHash("sha256").update(text, "utf8").digest("hex");
console.log(`File SHA256: ${fileSha256}`);

const parsed = parseWechatMarkdown({ root: SOURCE_ROOT, document: DOC_RELATIVE, text, media: new Map() });
console.log(`Conversation ID: ${parsed.conversationId}`);
console.log(`Total messages: ${parsed.messages.length}`);

// Get canonical IDs for selected ordinals
const selectedMessages = parsed.messages.filter(m => SELECTED_ORDINALS.has(m.sourceLocator?.recordOrdinal));
console.log(`Selected ${selectedMessages.length} messages from ${SELECTED_ORDINALS.size} ordinals`);

if (selectedMessages.length !== SELECTED_ORDINALS.size) {
  const foundOrdinals = new Set(selectedMessages.map(m => m.sourceLocator?.recordOrdinal));
  const missing = [...SELECTED_ORDINALS].filter(o => !foundOrdinals.has(o));
  console.warn(`Warning: ${missing.length} ordinals not found: ${missing.join(", ")}`);
}

const messageIds = selectedMessages.map(m => m.messageId);
const recordOrdinals = selectedMessages.map(m => m.sourceLocator?.recordOrdinal).filter(Boolean);

// Print selected messages for verification
console.log("\nSelected messages:");
for (const m of selectedMessages) {
  console.log(`  [ord=${m.sourceLocator?.recordOrdinal}] ${m.sentAt.slice(0, 10)} ${m.senderName}: ${m.text.slice(0, 60)}`);
}

const manifest = {
  document: DOC_RELATIVE,
  fileSha256,
  conversationId: parsed.conversationId,
  messageIds,
  recordOrdinals,
};

writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2), "utf8");
console.log(`\nManifest saved to: ${OUT_PATH}`);
console.log(`Messages: ${messageIds.length}`);
