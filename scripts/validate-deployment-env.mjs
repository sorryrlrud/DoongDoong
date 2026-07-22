import { loadEnv } from "vite";

const target = process.argv[2];
if (!new Set(["development", "production"]).has(target)) {
  throw new Error("Usage: node scripts/validate-deployment-env.mjs <development|production>");
}

const values = loadEnv(target, process.cwd(), "");
const required = [
  "VITE_DEPLOYMENT_ENV",
  "VITE_PUBLIC_APP_URL",
  "VITE_BASE_PATH",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PROJECT_REF",
];
const missing = required.filter((name) => !values[name]?.trim());
if (missing.length) {
  throw new Error(`Missing ${target} deployment variables: ${missing.join(", ")}`);
}

if (values.VITE_DEPLOYMENT_ENV !== target) {
  throw new Error(
    `Environment mismatch: requested '${target}' but VITE_DEPLOYMENT_ENV is '${values.VITE_DEPLOYMENT_ENV}'.`,
  );
}

const basePath = values.VITE_BASE_PATH;
if (!basePath.startsWith("/") || !basePath.endsWith("/") || basePath.includes("//")) {
  throw new Error("VITE_BASE_PATH must start and end with '/' and cannot contain '//'.");
}

const publicUrl = new URL(values.VITE_PUBLIC_APP_URL);
if (publicUrl.pathname !== basePath) {
  throw new Error(
    `VITE_PUBLIC_APP_URL pathname '${publicUrl.pathname}' must equal VITE_BASE_PATH '${basePath}'.`,
  );
}
if (publicUrl.search || publicUrl.hash) {
  throw new Error("VITE_PUBLIC_APP_URL cannot contain a query string or hash.");
}

const supabaseUrl = new URL(values.VITE_SUPABASE_URL);
const expectedSupabaseHost = `${values.SUPABASE_PROJECT_REF}.supabase.co`;
if (supabaseUrl.hostname !== expectedSupabaseHost) {
  throw new Error(
    `Supabase mismatch: URL host '${supabaseUrl.hostname}' does not match project ref '${values.SUPABASE_PROJECT_REF}'.`,
  );
}
if (supabaseUrl.protocol !== "https:") {
  throw new Error("Cloud deployment VITE_SUPABASE_URL must use HTTPS.");
}

const deploymentValues = required.map((name) => values[name]).join("\n");
if (/YOUR_|example\.(?:com|invalid)/i.test(deploymentValues)) {
  throw new Error(`${target} deployment variables still contain placeholder values.`);
}

if (target === "production") {
  if (publicUrl.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(publicUrl.hostname)) {
    throw new Error("Production VITE_PUBLIC_APP_URL must be a non-local HTTPS URL.");
  }
}

if (/service.role|service_role/i.test(values.VITE_SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error("A service-role key must never be exposed through a VITE_ variable.");
}

console.log(
  `Validated ${target}: ${publicUrl.toString()} -> ${supabaseUrl.hostname} (${basePath})`,
);
