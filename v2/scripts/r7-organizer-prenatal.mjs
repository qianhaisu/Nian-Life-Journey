/**
 * Run organizer-month-write on prenatal months via RDS tunnel.
 * Generates prenatal life_events from the imported private-chat/parents-group sources.
 * Only messages that name 张年 will pass the subject gate.
 *
 * Usage (dry-run first):
 *   node --import tsx scripts/r7-organizer-prenatal.mjs --month=2024-11
 *   node --import tsx scripts/r7-organizer-prenatal.mjs --month=2024-11 --commit
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { spawn } from "node:child_process";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const args = process.argv.slice(2);
if (!args.find(a => a.startsWith("--month="))) {
  console.error("--month=YYYY-MM required");
  process.exit(1);
}

const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
const dbUrl = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
console.log(`Tunnel open. Running organizer for ${args.join(" ")}...`);

const outFile = `C:/Users/teddy/Documents/NianlifeOps/artifacts/NIGHT-RELATIONS-20260921/organizer-prenatal-${args.find(a => a.startsWith("--month="))?.replace("--month=", "")}.json`;

const childArgs = ["--import", "tsx", "scripts/organizer-month-write.mjs", ...args, `--out=${outFile}`];
const child = spawn("node", childArgs, {
  env: {
    ...process.env,
    REPOSITORY_BACKEND: "postgres",
    DATABASE_URL: dbUrl,
    DATABASE_URL_UNPOOLED: dbUrl,
    AI_PROVIDER: "deepseek",
    AI_MODEL: "deepseek-flash",
    ORGANIZER_V2_ENABLED: "true",
  },
  stdio: "inherit",
  cwd: path.resolve(process.cwd()),
});

child.on("close", (code) => {
  tunnel.close();
  process.exit(code ?? 0);
});
