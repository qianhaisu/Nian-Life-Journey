import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ChatImportBundle, ChatMediaRef, MediaAvailability } from "./chat-import-bundle";
import { parseWechatMarkdown } from "./wechat-markdown";
import { isWeflowJson, parseWeflowJson } from "./wechat-weflow-json";

export type WechatSnapshotEntry = { relativePath: string; absolutePath: string; kind: "markdown" | "weflow-json" | "jpeg" | "other"; size: number; mtimeMs: number; contentDigest?: string };
export type WechatSnapshot = { rootFingerprint: string; fileCount: number; files: WechatSnapshotEntry[] };
export type WechatBundleOptions = { maxMessages?: number; maxMedia?: number; now?: string; conversationIndex?: number; since?: string };
export type WechatBundleLoad = { snapshot: WechatSnapshot; bundle: ChatImportBundle; selectedDocument: string; availableMessageCount: number; selectedMessageCount: number; availableMediaRefCount: number; selectedMediaRefCount: number };
export type WechatCapacityAudit = { fileCount: number; markdownFileCount: number; jpegFileCount: number; otherFileCount: number; availableMessageCount: number; selectedMessageCount: number; availableMediaRefCount: number; selectedMediaRefCount: number; presentMediaCount: number; missingMediaCount: number; needsReviewMediaCount: number; invalidMediaCount: number; hashChangedMediaCount: number; deferredByLimitMediaCount: number; messageLimitReached: boolean; mediaLimitReached: boolean; maxMessages: number; maxMedia: number };

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const normalizeRelative = (value: string) => value.replaceAll("\\", "/");
const isJpeg = (relativePath: string) => /\.(?:jpe?g)$/i.test(relativePath);

function inside(root: string, candidate: string) {
  const relativePath = path.relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function assertSafeEntry(root: string, rootReal: string, candidate: string) {
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) throw new Error("WECHAT_SOURCE_SYMLINK");
  const real = await realpath(candidate);
  if (!inside(rootReal, real)) throw new Error("WECHAT_SOURCE_OUTSIDE_ROOT");
  return info;
}

async function streamDigest(absolutePath: string) {
  const stream = createReadStream(absolutePath);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) { hash.update(chunk); size += chunk.byteLength; }
  return { digest: hash.digest("hex"), size };
}

async function walk(root: string, rootReal: string, directory: string, entries: WechatSnapshotEntry[]) {
  const children = (await readdir(directory, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    const absolutePath = path.join(directory, child.name);
    const info = await assertSafeEntry(root, rootReal, absolutePath);
    if (child.isDirectory()) {
      await walk(root, rootReal, absolutePath, entries);
      continue;
    }
    if (!child.isFile()) continue;
    const relativePath = normalizeRelative(path.relative(root, absolutePath));
    // WeFlow writes a .json transcript beside the .md one, and for four of the family's groups the
    // JSON is the only place their history exists. It is a transcript like the Markdown is, so it is
    // digested and drift-checked the same way.
    const kind = /\.md$/i.test(relativePath) ? "markdown" : /\.json$/i.test(relativePath) ? "weflow-json" : isJpeg(relativePath) ? "jpeg" : "other";
    const content = kind === "markdown" || kind === "weflow-json" ? await streamDigest(absolutePath) : undefined;
    entries.push({ relativePath, absolutePath, kind, size: info.size, mtimeMs: info.mtimeMs, contentDigest: content?.digest });
  }
}

export async function scanWechatSnapshot(sourceRoot: string): Promise<WechatSnapshot> {
  const root = path.resolve(sourceRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("WECHAT_SOURCE_ROOT_INVALID");
  const rootReal = await realpath(root);
  if (!inside(root, rootReal)) throw new Error("WECHAT_SOURCE_ROOT_INVALID");
  const files: WechatSnapshotEntry[] = [];
  await walk(root, rootReal, root, files);
  const sorted = files.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of sorted) hash.update(`${file.relativePath}\u0000${file.kind}\u0000${file.size}\u0000${Math.round(file.mtimeMs * 1000)}\u0000${file.contentDigest ?? ""}\n`, "utf8");
  return { rootFingerprint: hash.digest("hex"), fileCount: files.length, files };
}

export async function hashWechatFile(entry: WechatSnapshotEntry) {
  const result = await streamDigest(entry.absolutePath);
  return { checksum: `sha256:${result.digest}`, size: result.size };
}

async function mediaStatus(entry: WechatSnapshotEntry | undefined, limitReached: boolean): Promise<{ checksum?: string; availability: MediaAvailability; mimeType?: string; fileSize?: number; width?: number; height?: number }> {
  if (!entry) return { availability: "missing" };
  if (limitReached) return { availability: "deferred_by_limit" };
  try {
    const metadata = await sharp(entry.absolutePath).metadata();
    if (metadata.format !== "jpeg") return { availability: "invalid" };
    const hashed = await hashWechatFile(entry);
    if (hashed.size !== entry.size) return { availability: "hash_changed" };
    return { checksum: hashed.checksum, availability: "present", mimeType: "image/jpeg", fileSize: hashed.size, width: metadata.width, height: metadata.height };
  } catch {
    return { availability: "invalid" };
  }
}

function refsFromMessages(messages: Array<{ mediaRefs: ChatMediaRef[] }>) {
  const refs = new Map<string, ChatMediaRef>();
  for (const message of messages) for (const ref of message.mediaRefs) if (!refs.has(ref.relativePath)) refs.set(ref.relativePath, ref);
  return refs;
}

// One conversation is one transcript file, in whichever of WeFlow's two formats it was written.
// Both parsers return the same shape, so the whole pipeline below this point is format-blind.
function parseTranscript(
  entry: WechatSnapshotEntry,
  root: string,
  text: string,
  media: Map<string, { checksum?: string; availability: MediaAvailability; mimeType?: string; fileSize?: number; width?: number; height?: number }>,
) {
  // A .json in the export root is only a transcript if it says so. Anything else is left alone
  // rather than guessed at: a stray JSON file with a `messages` array must not become a conversation.
  if (entry.kind === "weflow-json") {
    if (!isWeflowJson(text)) return { document: entry.relativePath, conversationId: "", conversationName: "", messages: [], warnings: ["not_a_weflow_transcript"] };
    return parseWeflowJson({ root, document: entry.relativePath, media, text });
  }
  return parseWechatMarkdown({ root, document: entry.relativePath, media, text });
}

export async function loadWechatBundle(sourceRoot: string, options: WechatBundleOptions = {}): Promise<WechatBundleLoad> {
  const maxMessages = options.maxMessages ?? 100;
  const maxMedia = options.maxMedia ?? 20;
  // The canary's own defaults stay 100/20 (see WechatBundleOptions callers); this ceiling only
  // guards against a nonsensical or unbounded value, so a full-conversation import (which passes
  // the conversation's true message/media count, discovered up front, not a guessed sentinel)
  // is never truncated by an arbitrary canary-era cap.
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 200_000) throw new Error("WECHAT_MESSAGE_LIMIT_INVALID");
  if (!Number.isInteger(maxMedia) || maxMedia < 1 || maxMedia > 200_000) throw new Error("WECHAT_MEDIA_LIMIT_INVALID");
  const sinceMs = options.since !== undefined ? Date.parse(options.since) : undefined;
  if (sinceMs !== undefined && Number.isNaN(sinceMs)) throw new Error("WECHAT_SINCE_INVALID");
  const snapshot = await scanWechatSnapshot(sourceRoot);
  const transcripts = snapshot.files.filter((file) => file.kind === "markdown" || file.kind === "weflow-json").toSorted((a, b) => digest(a.relativePath).localeCompare(digest(b.relativePath)));
  const candidates: Array<{ entry: WechatSnapshotEntry; text: string; conversationId: string; messages: ReturnType<typeof parseWechatMarkdown>["messages"] }> = [];
  for (const entry of transcripts) {
    const text = await readFile(entry.absolutePath, "utf8");
    if (entry.contentDigest && digest(text) !== entry.contentDigest) throw new Error("WECHAT_SNAPSHOT_CHANGED_DURING_SCAN");
    const parsed = parseTranscript(entry, path.resolve(sourceRoot), text, new Map());
    if (parsed.messages.length) candidates.push({ entry, text, conversationId: parsed.conversationId, messages: parsed.messages });
  }
  // candidates is already in the deterministic (relativePath-digest) order established above;
  // conversationIndex picks a specific position in that same stable order instead of always
  // taking position 0, so a chosen medium-scale conversation stays chosen across process restarts.
  const conversationIndex = options.conversationIndex ?? 0;
  if (!Number.isInteger(conversationIndex) || conversationIndex < 0) throw new Error("WECHAT_CONVERSATION_INDEX_INVALID");
  const selected = candidates[conversationIndex];
  if (!selected) throw new Error("WECHAT_NO_VALID_SESSION");
  const eligibleMessages = sinceMs !== undefined ? selected.messages.filter((message) => Date.parse(message.sentAt) >= sinceMs) : selected.messages;
  const availableMessageCount = eligibleMessages.length;
  const selectedMessages = eligibleMessages.slice(0, maxMessages);
  const availableMediaRefCount = refsFromMessages(eligibleMessages).size;
  const byPath = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const refs = refsFromMessages(selectedMessages);
  const media = new Map<string, { checksum?: string; availability: MediaAvailability }>();
  let hashedMedia = 0;
  for (const [relativePath] of refs) {
    const entry = byPath.get(relativePath);
    if (!entry || entry.kind !== "jpeg") {
      media.set(relativePath, { availability: entry ? "invalid" : "missing" });
      continue;
    }
    const state = await mediaStatus(entry, hashedMedia >= maxMedia);
    media.set(relativePath, state);
    if (state.availability === "present") hashedMedia += 1;
  }
  const reparsed = parseTranscript(selected.entry, path.resolve(sourceRoot), selected.text, media);
  const reparsedEligible = sinceMs !== undefined ? reparsed.messages.filter((message) => Date.parse(message.sentAt) >= sinceMs) : reparsed.messages;
  const messages = reparsedEligible.slice(0, maxMessages);
  const mediaRefs = [...new Map(messages.flatMap((message) => message.mediaRefs).map((ref) => [ref.id, ref])).values()];
  const bundle: ChatImportBundle = {
    schemaVersion: "chat-import-bundle/v1",
    parserVersion: "wechat-official-markdown/1",
    sourceProvider: "wechat-official-markdown",
    sourceTimezone: "Asia/Shanghai",
    exportSnapshot: { rootFingerprint: snapshot.rootFingerprint, conversationDigest: digest(selected.entry.relativePath), capturedAt: options.now ?? new Date().toISOString(), fileCount: snapshot.fileCount },
    conversations: [{ id: reparsed.conversationId, name: "conversation", participantIds: [] }],
    participants: [],
    messages,
    mediaRefs,
    warnings: [],
  };
  return { snapshot, bundle, selectedDocument: selected.entry.relativePath, availableMessageCount, selectedMessageCount: messages.length, availableMediaRefCount, selectedMediaRefCount: mediaRefs.length };
}

export async function auditWechatCapacity(sourceRoot: string, options: WechatBundleOptions = {}): Promise<WechatCapacityAudit> {
  const maxMessages = options.maxMessages ?? 100;
  const maxMedia = options.maxMedia ?? 20;
  const loaded = await loadWechatBundle(sourceRoot, { ...options, maxMessages, maxMedia });
  const counts = new Map<"present" | "missing" | "needs_review" | "invalid" | "hash_changed" | "deferred_by_limit", number>();
  for (const ref of loaded.bundle.mediaRefs) counts.set(ref.availability, (counts.get(ref.availability) ?? 0) + 1);
  const markdownFileCount = loaded.snapshot.files.filter((file) => file.kind === "markdown").length;
  const jpegFileCount = loaded.snapshot.files.filter((file) => file.kind === "jpeg").length;
  return {
    fileCount: loaded.snapshot.fileCount,
    markdownFileCount,
    jpegFileCount,
    otherFileCount: loaded.snapshot.fileCount - markdownFileCount - jpegFileCount,
    availableMessageCount: loaded.availableMessageCount,
    selectedMessageCount: loaded.selectedMessageCount,
    availableMediaRefCount: loaded.availableMediaRefCount,
    selectedMediaRefCount: loaded.selectedMediaRefCount,
    presentMediaCount: counts.get("present") ?? 0,
    missingMediaCount: counts.get("missing") ?? 0,
    needsReviewMediaCount: counts.get("needs_review") ?? 0,
    invalidMediaCount: counts.get("invalid") ?? 0,
    hashChangedMediaCount: counts.get("hash_changed") ?? 0,
    deferredByLimitMediaCount: counts.get("deferred_by_limit") ?? 0,
    messageLimitReached: loaded.availableMessageCount > loaded.selectedMessageCount,
    mediaLimitReached: (counts.get("deferred_by_limit") ?? 0) > 0,
    maxMessages,
    maxMedia,
  };
}

export async function assertWechatSnapshot(sourceRoot: string, expectedFingerprint: string) {
  const snapshot = await scanWechatSnapshot(sourceRoot);
  if (snapshot.rootFingerprint !== expectedFingerprint) throw new Error("WECHAT_SNAPSHOT_MISMATCH");
  return snapshot;
}
