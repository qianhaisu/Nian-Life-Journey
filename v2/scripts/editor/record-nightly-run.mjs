import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const arg = (key) => args[args.indexOf(`--${key}`) + 1];
const stages = Object.fromEntries(["editor", "backfill", "reminders", "carousel"].map((name) => {
  const value = arg(name);
  if (!/^-?\d+$/.test(value ?? "")) throw new Error(`missing exit code: ${name}`);
  return [name, Number(value)];
}));
const dir = path.join(process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily", "editor", "runs");
fs.mkdirSync(dir, { recursive: true });
const receipt = { at: new Date().toISOString(), stamp: arg("stamp"), stages, ok: Object.values(stages).every((code) => code === 0) };
const dest = path.join(dir, "latest.json");
fs.writeFileSync(`${dest}.tmp`, JSON.stringify(receipt, null, 2));
fs.renameSync(`${dest}.tmp`, dest);
console.log(JSON.stringify(receipt));
