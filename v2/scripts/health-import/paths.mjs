// Private-output boundary: real health data must never be written inside the git repository.
// Paths are resolved through symlinks/junctions (nearest existing ancestor is realpath'd), and the repo root itself is refused.
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
export function repoRoot() {
  return realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
}
export function resolveThroughLinks(p) {
  let cur = path.resolve(String(p));
  const rest = [];
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(realpathSync(cur), ...rest);
}
export function isInsideRepo(p, root = repoRoot()) {
  const rel = path.relative(norm(root), norm(resolveThroughLinks(p)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
export function assertOutsideRepo(p, label = "path") {
  if (isInsideRepo(p)) throw new Error(`${label} resolves inside the git repository; private health data must live outside it`);
  return resolveThroughLinks(p);
}
