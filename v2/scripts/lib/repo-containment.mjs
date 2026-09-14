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
//   · Strings are not enough: `\\localhost\C$\…\Nianlife\docs` realpaths to itself, shares no prefix
//     with `C:\…\Nianlife`, and is the same directory (page review G17). So every existing ancestor, on
//     both the literal and the resolved chain, is compared by FILE IDENTITY (bigint dev + ino) with the
//     repository root; a match is inside, whatever the spelling.
//   · Windows: UNC and device-namespace forms (`\\server\share`, `\\?\`, `\\.\`) are refused outright,
//     as is a path segment ending in a dot or space or carrying a colon (alternate data stream) — Win32
//     rewrites or reinterprets those, and the answer should not depend on which layer does.
//   · Anything that cannot be resolved — a dangling link, a path through a file, an error other than
//     "does not exist", an ancestor whose identity cannot be read — is refused. Fail closed.
//   · Windows: path.win32 compares case-insensitively; a different drive is outside.
//
// Known residue: the check and the write are separate steps. Callers re-run the check immediately before
// writing and create the file with an exclusive flag, which narrows but does not close the window in which
// a parent directory could be swapped for a link.
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

/**
 * Windows spellings this check refuses rather than interprets: UNC / device namespace (`\\…`, `//…`), and
 * any segment that ends in "." or " " or contains ":" (other than the drive letter). Always false on POSIX.
 */
export function hasRefusedWindowsForm(target, api = path) {
  if (api.sep !== "\\") return false;
  const raw = String(target);
  if (/^[\\/]{2}/.test(raw)) return true;
  const resolved = api.resolve(raw);
  if (/^[\\/]{2}/.test(resolved)) return true;
  const rest = resolved.slice(api.parse(resolved).root.length);
  for (const text of [raw.replace(/^[a-zA-Z]:/, ""), rest]) {
    for (const segment of text.split(/[\\/]/)) {
      if (segment === "" || segment === "." || segment === "..") continue;
      if (segment.endsWith(".") || segment.endsWith(" ") || segment.includes(":")) return true;
    }
  }
  return false;
}

function nearestExisting(target, fsApi, api) {
  let current = api.resolve(target);
  const missing = [];
  for (;;) {
    try {
      fsApi.lstatSync(current);
      return { existing: current, missing };
    } catch (error) {
      if (error?.code !== "ENOENT") throw new ContainmentError("PATH_UNRESOLVABLE", `${current} (${error?.code ?? String(error)})`);
      const parent = api.dirname(current);
      if (parent === current) throw new ContainmentError("PATH_UNRESOLVABLE", `no existing ancestor for ${target}`);
      missing.unshift(api.basename(current));
      current = parent;
    }
  }
}

/** Resolves `target` through every existing symlink/junction on its way; throws ContainmentError when it cannot. */
export function resolveThroughLinks(target, fsApi = fs, api = path) {
  return resolveFrom(nearestExisting(target, fsApi, api), target, fsApi, api).real;
}

function resolveFrom({ existing, missing }, target, fsApi, api) {
  let realExisting;
  try {
    realExisting = fsApi.realpathSync.native(existing);
  } catch (error) {
    throw new ContainmentError("PATH_UNRESOLVABLE", `${existing} exists but does not resolve (${error?.code ?? String(error)}); a dangling link is refused`);
  }
  if (!missing.length) return { realExisting, real: realExisting };
  // Windows reports ENOENT (not ENOTDIR) for a path that runs through a regular file, so the walk above
  // can stop at a file. A missing tail can only ever be created under a directory; anything else is
  // not a real location and is refused rather than judged.
  let isDirectory = false;
  try { isDirectory = fsApi.statSync(realExisting).isDirectory(); } catch { isDirectory = false; }
  if (!isDirectory) throw new ContainmentError("PATH_UNRESOLVABLE", `${realExisting} is not a directory, so ${target} cannot exist under it`);
  return { realExisting, real: api.join(realExisting, ...missing) };
}

function identityOf(p, fsApi) {
  const stat = fsApi.statSync(p, { bigint: true });
  if (stat.ino === 0n) throw Object.assign(new Error("file identity unavailable (ino 0)"), { code: "NO_IDENTITY" });
  return `${stat.dev}:${stat.ino}`;
}

/** The file identities (dev:ino) of the repository root, as written and as resolved. */
export function repositoryIdentities(repo, fsApi = fs) {
  try {
    return new Set([identityOf(repo.literal, fsApi), identityOf(repo.real, fsApi)]);
  } catch (error) {
    throw new ContainmentError("REPOSITORY_ROOT_NOT_FOUND", `cannot read the repository root identity (${error?.code ?? String(error)})`);
  }
}

/** Walks `start` and its ancestors (following links); returns the first one whose identity is in `identities`, else null. */
export function findAncestorWithIdentity(start, identities, fsApi = fs, api = path) {
  let current = api.resolve(start);
  for (;;) {
    let identity;
    try {
      identity = identityOf(current, fsApi);
    } catch (error) {
      throw new ContainmentError("PATH_UNRESOLVABLE", `cannot read the file identity of ${current} (${error?.code ?? String(error)})`);
    }
    if (identities.has(identity)) return current;
    const parent = api.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
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

/** Throws unless `target` is outside `repo` as written, as the filesystem resolves it, and by file identity. */
export function assertOutsideRepository(target, repo, fsApi = fs, api = path) {
  if (hasRefusedWindowsForm(target, api)) throw new ContainmentError("PATH_FORM_REFUSED", String(target));
  const literal = api.resolve(target);
  if (isInsideDirectory(literal, repo.literal, api) || isInsideDirectory(literal, repo.real, api)) {
    throw new ContainmentError("INSIDE_REPOSITORY", literal);
  }
  const located = nearestExisting(literal, fsApi, api);
  const { realExisting, real } = resolveFrom(located, literal, fsApi, api);
  if (isInsideDirectory(real, repo.real, api) || isInsideDirectory(real, repo.literal, api)) {
    throw new ContainmentError("INSIDE_REPOSITORY_THROUGH_LINK", `${literal} -> ${real}`);
  }
  if (hasRefusedWindowsForm(real, api)) throw new ContainmentError("PATH_FORM_REFUSED", `${literal} -> ${real}`);
  const identities = repositoryIdentities(repo, fsApi);
  for (const start of [located.existing, realExisting]) {
    const hit = findAncestorWithIdentity(start, identities, fsApi, api);
    if (hit) throw new ContainmentError("INSIDE_REPOSITORY_BY_IDENTITY", `${literal}: ${hit} is the repository root`);
  }
  return { literal, real };
}
