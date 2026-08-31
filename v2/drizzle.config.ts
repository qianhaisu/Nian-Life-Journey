import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";
loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local") });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Drizzle commands; refusing to use a local fallback database.");
export default defineConfig({ schema: "./lib/db/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url: databaseUrl } });
