import type path from "node:path";
import type fs from "node:fs";

type PathApi = Pick<typeof path, "resolve" | "relative" | "isAbsolute" | "dirname" | "basename" | "join" | "sep" | "parse">;
type FsApi = Pick<typeof fs, "lstatSync" | "existsSync" | "statSync"> & { realpathSync: { native(p: string): string } };
type RepositoryRoot = { literal: string; real: string };

export declare class ContainmentError extends Error {
  readonly code: "INSIDE_REPOSITORY" | "INSIDE_REPOSITORY_THROUGH_LINK" | "INSIDE_REPOSITORY_BY_IDENTITY" | "PATH_FORM_REFUSED" | "PATH_UNRESOLVABLE" | "REPOSITORY_ROOT_NOT_FOUND";
  constructor(code: string, message: string);
}
export declare function isParentRelative(relative: string, api?: PathApi): boolean;
export declare function isInsideDirectory(target: string, root: string, api?: PathApi): boolean;
export declare function hasRefusedWindowsForm(target: string, api?: PathApi): boolean;
export declare function resolveThroughLinks(target: string, fsApi?: FsApi, api?: PathApi): string;
export declare function repositoryIdentities(repo: RepositoryRoot, fsApi?: FsApi): Set<string>;
export declare function findAncestorWithIdentity(start: string, identities: Set<string>, fsApi?: FsApi, api?: PathApi): string | null;
export declare function findRepositoryRoot(scriptUrl: string | URL, fsApi?: FsApi, api?: PathApi): RepositoryRoot;
export declare function assertOutsideRepository(target: string, repo: RepositoryRoot, fsApi?: FsApi, api?: PathApi): RepositoryRoot;
