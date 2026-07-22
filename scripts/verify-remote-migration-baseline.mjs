import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const migrationDirectory = join(import.meta.dirname, "..", "supabase", "migrations");
const localVersions = readdirSync(migrationDirectory)
  .map((name) => /^(\d{12})_.+\.sql$/.exec(name)?.[1])
  .filter(Boolean)
  .sort();

if (localVersions.length === 0) {
  throw new Error("No local migrations found.");
}

const databasePassword = process.env.SUPABASE_DB_PASSWORD;
if (!databasePassword) {
  throw new Error("SUPABASE_DB_PASSWORD is required to read the linked migration ledger.");
}

const migrationList = spawnSync(
  "supabase",
  [
    "migration",
    "list",
    "--linked",
    "--password",
    databasePassword,
    "--output-format",
    "json",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

if (migrationList.status !== 0) {
  const details = [migrationList.stdout, migrationList.stderr]
    .filter(Boolean)
    .join("\n")
    .replaceAll(databasePassword, "[REDACTED]")
    .trim();
  throw new Error(
    `Unable to read the linked migration ledger; refusing deployment.${details ? `\n${details}` : ""}`,
  );
}

const output = migrationList.stdout;

const payloadStart = output.indexOf("{");
if (payloadStart < 0) {
  throw new Error("The linked migration ledger did not return JSON; refusing deployment.");
}

let payload;
try {
  payload = JSON.parse(output.slice(payloadStart));
} catch {
  throw new Error("Could not parse the linked migration ledger; refusing deployment.");
}

const remoteVersions = new Set(
  (payload.migrations ?? [])
    .map((migration) => migration.remote)
    .filter((version) => typeof version === "string" && /^\d{12}$/.test(version)),
);
const hardeningVersion = "202607210001";
const requiredBaseline = localVersions.filter((version) => version < hardeningVersion);
const missing = requiredBaseline.filter((version) => !remoteVersions.has(version));

if (missing.length > 0) {
  throw new Error(
    `Linked project is missing the verified historical baseline: ${missing.join(", ")}. `
      + "Do not run db push. Complete the reviewed schema diff and migration repair first.",
  );
}

console.log(`Verified ${requiredBaseline.length} historical migration versions in the linked ledger.`);
