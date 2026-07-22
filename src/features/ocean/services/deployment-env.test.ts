import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const validate = (overrides: Record<string, string>) => spawnSync(
  process.execPath,
  ["scripts/validate-deployment-env.mjs", overrides.VITE_DEPLOYMENT_ENV],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_DEPLOYMENT_ENV: "development",
      VITE_PUBLIC_APP_URL: "https://dev.doongdoong.app/",
      VITE_BASE_PATH: "/",
      VITE_SUPABASE_URL: "https://devproject.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_PROJECT_REF: "devproject",
      ...overrides,
    },
  },
);

describe("deployment environment validation", () => {
  it("accepts a consistent isolated development target", () => {
    const result = validate({ VITE_DEPLOYMENT_ENV: "development" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Validated development");
  });

  it("rejects a Supabase URL from a different project", () => {
    const result = validate({
      VITE_DEPLOYMENT_ENV: "development",
      VITE_SUPABASE_URL: "https://productionproject.supabase.co",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Supabase mismatch");
  });

  it("rejects an environment label that differs from the requested mode", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/validate-deployment-env.mjs", "production"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          VITE_DEPLOYMENT_ENV: "development",
          VITE_PUBLIC_APP_URL: "https://sorryrlrud.github.io/DoongDoong/",
          VITE_BASE_PATH: "/DoongDoong/",
          VITE_SUPABASE_URL: "https://prodproject.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
          SUPABASE_PROJECT_REF: "prodproject",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Environment mismatch");
  });
});
