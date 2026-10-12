import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_SSH = "ecs-user@47.99.243.155";
const KEY_NAME = "nianlife-prod-ecs.pem";

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

export class EcsConnectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EcsConnectionError";
    this.code = code;
  }
}

/**
 * Resolve the production identity before running SSH/SCP or doing editorial work.
 * An explicit ECS_KEY is authoritative: a missing file never selects another key.
 * Old Downloads keys remain usable only through ECS_KEY; never guess a fallback.
 * This helper checks the file's presence, without reading private key contents.
 */
export function resolveEcsConnection({ env = process.env, home = homedir(), exists = isFile } = {}) {
  const explicit = env.ECS_KEY !== undefined;
  if (explicit && (typeof env.ECS_KEY !== "string" || env.ECS_KEY.trim() === "")) {
    throw new EcsConnectionError("ECS_KEY_INVALID", "ECS_KEY must name an existing private key file; it cannot be empty.");
  }

  const key = explicit ? env.ECS_KEY : path.join(home, ".ssh", KEY_NAME);
  if (!exists(key)) {
    const source = explicit ? "Configured ECS_KEY" : "Default ECS private key";
    throw new EcsConnectionError(
      "ECS_KEY_MISSING",
      `${source} file does not exist: ${key}. Set ECS_KEY to the intended existing private key file; no alternative identity was selected.`,
    );
  }

  return { ssh: env.ECS_SSH ?? DEFAULT_SSH, key };
}
