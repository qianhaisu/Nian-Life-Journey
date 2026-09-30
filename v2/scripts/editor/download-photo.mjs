import fs from "node:fs";

// Only return bounded diagnostic labels: response bodies and transport errors can contain private data.
export async function downloadPhoto(url, file, { fetchImpl = fetch, writeFile = fs.writeFileSync } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    return { ok: false, status: null, reason: ["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "network" };
  }
  if (!response.ok) return { ok: false, status: response.status, reason: "http" };
  if (!/^image\//i.test(response.headers.get("content-type") ?? "")) return { ok: false, status: response.status, reason: "not-image" };
  let bytes;
  try { bytes = Buffer.from(await response.arrayBuffer()); }
  catch { return { ok: false, status: response.status, reason: "body-read" }; }
  if (!bytes.length) return { ok: false, status: response.status, reason: "empty-image" };
  try { writeFile(file, bytes); }
  catch { return { ok: false, status: response.status, reason: "file-write" }; }
  return { ok: true, status: response.status };
}
