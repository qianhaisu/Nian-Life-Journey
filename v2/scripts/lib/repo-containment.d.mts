import type path from "node:path";
import type fs from "node:fs";

type PathApi = Pick<typeof path, "resolve" | "relative" | "isAbsolute" | "dirname" | "basename" | "join" | "sep">;
type FsApi = Pick<typeof fs, "lstatSync" | "existsSync" | "statSync"> & { realpathSync: { native(p: string): string } };

export declare class ContainmentError extends Error {
  readonly code: "INSIDE_REPOSITORY" | "INSIDE_REPOSITORY_THROUGH_LINK" | "PATH_UNRESOLVABLE" | "REPOSITORY_ROOT_NOT_FOUND";
  constructor(code: string, message: string);
}
export declare function isParentRelative(relative: string, api?: PathApi): boolean;
export declare function isInsideDirectory(target: string, root: string, api?: PathApi): boolean;
export declare function resolveThroughLinks(target: string, fsApi?: FsApi, api?: PathApi): string;
export declare function findRepositoryRoot(scriptUrl: string | URL, fsApi?: FsApi, api?: PathApi): { literal: string; real: string };
export declare function assertOutsideRepository(target: string, repo: { literal: string; real: string }, fsApi?: FsApi, api?: PathApi): { literal: string; real: string };
