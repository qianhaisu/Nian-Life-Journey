// "Is this path outside the repository?" for scripts that write family text (DATA-0914-05).
//
// Plain JavaScript on purpose: the story-review CLI must answer this BEFORE any TypeScript loader or
// repository import runs, and before a single byte is written. lib/review/repo-path.ts re-exports it.
//
// The rules, each one a real hole in an earlier version:
//   · A relative path is a PARENT only when it is exactly ".." or starts with ".." followed by a
//     separator. `startsWith("..")` also matched a legal directory named "..review" inside the repo.
//   · The repository root is found from the calling script's own location, never from the working
//     directory, and is compared both literally and through realpath.
//   · The target is resolved through symlinks and junctions: walk up to the nearest ancestor that exists
//     (lstat, so a dangling link counts as existing), realpath it, and re-append the part that does not
//     exist yet. A target that is itself a link resolves to wherever it points.
//   · Both the literal and the resolved path must be outside; if either is inside, refuse.
//   · Anything that cannot be resolved — a dangling link, a path through a file, an error other than
//     "does not exist" — is refused. Fail closed.
//   · Windows: path.win32 compares case-insensitively; a different drive is outside.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class ContainmentError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "ContainmentError";
    this.code = code;
  }
}

export function isParentRelative(relative, api = path) {
  return relative === ".." || relative.startsWith(`..${api.sep}`) || (api.sep === "\\" && relative.startsWith("../"));
}

/** True when `target` is `root` itself or beneath it, on lexically resolved absolute paths. */
export function isInsideDirectory(target, root, api = path) {
  const relative = api.relative(api.resolve(root), api.resolve(target));
  if (relative === "") return true;
  if (api.isAbsolute(relative)) return false;
  return !isParentRelative(relative, api);
}

/** Resolves `target` through every existing symlink/junction on its way; throws ContainmentError when it cannot. */
export function resolveThroughLinks(target, fsApi = fs, api = path) {
  let current = api.resolve(target);
  const missing = [];
  for (;;) {
    try {
      fsApi.lstatSync(current);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw new ContainmentError("PATH_UNRESOLVABLE", `${current} (${error?.code ?? String(error)})`);
      const parent = api.dirname(current);
      if (parent === current) throw new ContainmentError("PATH_UNRESOLVABLE", `no existing ancestor for ${target}`);
      missing.unshift(api.basename(current));
      current = parent;
    }
  }
  let real;
  try {
    real = fsApi.realpathSync.native(current);
  } catch (error) {
    throw new ContainmentError("PATH_UNRESOLVABLE", `${current} exists but does not resolve (${error?.code ?? String(error)}); a dangling link is refused`);
  }
  if (!missing.length) return real;
  // Windows reports ENOENT (not ENOTDIR) for a path that runs through a regular file, so the walk above
  // can stop at a file. A missing tail can only ever be created under a directory; anything else is
  // not a real location and is refused rather than judged.
  let isDirectory = false;
  try { isDirectory = fsApi.statSync(real).isDirectory(); } catch { isDirectory = false; }
  if (!isDirectory) throw new ContainmentError("PATH_UNRESOLVABLE", `${real} is not a directory, so ${target} cannot exist under it`);
  return api.join(real, ...missing);
}

/** The repository root two levels above the calling script (v2/scripts/<file> → repo root). */
export function findRepositoryRoot(scriptUrl, fsApi = fs, api = path) {
  const literal = api.resolve(api.dirname(fileURLToPath(scriptUrl)), "..", "..");
  if (!fsApi.existsSync(api.join(literal, ".git"))) throw new ContainmentError("REPOSITORY_ROOT_NOT_FOUND", literal);
  let real;
  try {
    real = fsApi.realpathSync.native(literal);
  } catch (error) {
    throw new ContainmentError("REPOSITORY_ROOT_NOT_FOUND", `${literal} (${error?.code ?? String(error)})`);
  }
  return { literal, real };
}

/** Throws unless `target` is outside `repo` both as written and as the filesystem resolves it. */
export function assertOutsideRepository(target, repo, fsApi = fs, api = path) {
  const literal = api.resolve(target);
  if (isInsideDirectory(literal, repo.literal, api) || isInsideDirectory(literal, repo.real, api)) {
    throw new ContainmentError("INSIDE_REPOSITORY", literal);
  }
  const real = resolveThroughLinks(literal, fsApi, api);
  if (isInsideDirectory(real, repo.real, api) || isInsideDirectory(real, repo.literal, api)) {
    throw new ContainmentError("INSIDE_REPOSITORY_THROUGH_LINK", `${literal} -> ${real}`);
  }
  return { literal, real };
}
