// Private-data boundary: the REAL landing place of every path is checked (symlinks / Windows junctions resolved through
// the nearest existing ancestor; a not-yet-created suffix is appended). Same idea as scripts/health-import/paths.mjs.
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

export function resolveThroughLinks(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(realpathSync(cur), ...rest);
}
export const repoRootOf = (cwd: string) => resolveThroughLinks(path.basename(cwd) === "v2" ? path.dirname(cwd) : cwd);
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(norm(parent), norm(resolveThroughLinks(child)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
