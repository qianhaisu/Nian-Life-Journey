import path from "node:path";

type PathApi = Pick<typeof path, "resolve" | "relative" | "isAbsolute">;

/**
 * True when `target` is `root` itself or anything beneath it. Decided on resolved absolute paths, so
 * the caller's working directory never changes the answer. On Windows `path.win32.relative` compares
 * case-insensitively and returns an absolute path for a different drive, which is outside.
 */
export function isInsideDirectory(target: string, root: string, api: PathApi = path): boolean {
  const relative = api.relative(api.resolve(root), api.resolve(target));
  if (relative === "") return true;
  return !relative.startsWith("..") && !api.isAbsolute(relative);
}
