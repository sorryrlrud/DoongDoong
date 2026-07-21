import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const phaseOneMigrationFile = "202607210001_ocean_pwa_hardening.sql";
const manualLegacyCutoverFile = path.join(
  root,
  "supabase",
  "manual",
  "202607220001_revoke_legacy_ocean_send_message.sql",
);
const knownOneOffMigrations = new Set([
  "202607160003_country_origin_demo_reset.sql",
  "202607170006_reset_users_for_social_auth.sql",
]);

const migrationFiles = (await readdir(migrationsDir))
  .filter((file) => /^\d{12}_.+\.sql$/.test(file))
  .sort();

if (migrationFiles.length === 0) throw new Error("No Supabase migrations found.");

const versions = migrationFiles.map((file) => file.slice(0, 12));
if (new Set(versions).size !== versions.length) {
  throw new Error("Supabase migration versions must be unique.");
}
if (versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
  throw new Error("Supabase migration versions must be strictly increasing.");
}

const topLevelSql = (sql) => sql
  // Operational functions need normal DELETE statements for account removal and
  // outbox pruning. Only scan statements that run while applying a migration.
  .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "")
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .toLowerCase();

const destructivePatterns = [
  /\btruncate\s+(?:table\s+)?/,
  /\bdelete\s+from\s+/,
  /\bdrop\s+(?:table|schema)\b/,
  /\balter\s+table\b[\s\S]*?\bdrop\s+column\b/,
];

for (const file of migrationFiles) {
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  const destructive = destructivePatterns.some((pattern) => pattern.test(topLevelSql(sql)));
  if (destructive && !knownOneOffMigrations.has(file)) {
    throw new Error(
      `${file} contains a top-level destructive operation. Move it to an approved one-off runbook instead of a regular migration.`,
    );
  }
  if (knownOneOffMigrations.has(file) && !/one[- ]time|cutover|launch|reset/i.test(sql)) {
    throw new Error(`${file} is allowlisted as a historical one-off but lacks an explicit warning header.`);
  }
}

// The phase-one migration and the phase-two revoke must stay separate. A
// cached Pages bundle can keep calling the legacy RPC while the new frontend
// reaches the Edge endpoint, so revoking them in one ordinary db push would
// create a production send outage.
const phaseOneSql = await readFile(path.join(migrationsDir, phaseOneMigrationFile), "utf8");
const manualLegacyCutoverSql = await readFile(manualLegacyCutoverFile, "utf8");
const legacySenderSignature = String.raw`public\s*\.\s*ocean_send_message\s*\(\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)`;
const phaseOneLegacyGrant = new RegExp(
  String.raw`grant\s+execute\s+on\s+function\s+${legacySenderSignature}\s+to\s+authenticated\s*;`,
  "i",
);
const phaseOneLegacyRevoke = new RegExp(
  String.raw`revoke\s+all\s+on\s+function\s+${legacySenderSignature}\s+from\s+[^;]*\bauthenticated\b`,
  "is",
);
const manualLegacyRevoke = new RegExp(
  String.raw`execute\s+'revoke\s+all\s+on\s+function\s+${legacySenderSignature}\s+from\s+[^']*\bauthenticated\b`,
  "is",
);

if (!phaseOneSql.includes("public.ocean_pwa_contract_status")) {
  throw new Error(`${phaseOneMigrationFile} must expose the Pages backend-readiness probe.`);
}
if (!phaseOneLegacyGrant.test(phaseOneSql)) {
  throw new Error(`${phaseOneMigrationFile} must retain the authenticated legacy sender during Phase 1.`);
}
if (phaseOneLegacyRevoke.test(topLevelSql(phaseOneSql))) {
  throw new Error(`${phaseOneMigrationFile} must not revoke the legacy sender during Phase 1.`);
}
if (!phaseOneSql.includes("private.revoke_legacy_ocean_send_message")
  || !manualLegacyRevoke.test(phaseOneSql)
  || !phaseOneSql.includes("phase_one_applied_at")
  || !phaseOneSql.includes("legacy_last_called_at")
  || !manualLegacyCutoverSql.includes("select private.revoke_legacy_ocean_send_message()")) {
  throw new Error("The manual legacy sender cutover must retain its revoke and time/telemetry gates.");
}

console.log(
  `Validated ${migrationFiles.length} ordered migrations, destructive-operation policy, and the phased legacy sender cutover.`,
);
