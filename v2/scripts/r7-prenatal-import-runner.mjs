/**
 * Wrapper to run wechat-import-all with RDS tunnel active.
 * Opens the night-rds.mjs tunnel, sets DATABASE_URL, then spawns the import.
 *
 * Usage:
 *   node --import tsx scripts/r7-prenatal-import-runner.mjs \
 *     --id-file=<manifest-path> [--source-root=<root>] [--since=<date>] [--dry-run]
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { spawn } from "node:child_process";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

const args = process.argv.slice(2);
const argOf = (n, fb) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : fb; };
const idFile = argOf("id-file", null);
if (!idFile) { console.error("--id-file=<path> required"); process.exit(1); }
const sourceRoot = argOf("source-root", "E:\\WechatHis");
const since = argOf("since", "2024-06-01");
const dryRun = args.includes("--dry-run");

console.log(`Opening RDS tunnel...`);
const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
const dbUrl = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
console.log(`Tunnel open. Running import...`);

const childArgs = [
  "--import", "tsx",
  "scripts/wechat-import-all.mjs",
  "--source-root", sourceRoot,
  "--since", since,
  "--id-file", idFile,
  ...(dryRun ? ["--dry-run"] : []),
];

const child = spawn("node", childArgs, {
  env: { ...process.env, REPOSITORY_BACKEND: "postgres", DATABASE_URL: dbUrl, DATABASE_URL_UNPOOLED: dbUrl },
  stdio: "inherit",
  cwd: path.resolve(process.cwd()),
});

child.on("close", (code) => {
  tunnel.close();
  process.exit(code ?? 0);
});
