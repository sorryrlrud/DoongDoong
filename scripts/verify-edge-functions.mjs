import assert from "node:assert/strict";

const baseUrl = (process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY;

if (!anonKey) throw new Error("SUPABASE_LOCAL_ANON_KEY is required for Edge Function verification.");

const waitFor = async (url) => {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { method: "OPTIONS" });
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Edge Functions did not become ready: ${lastError ?? "no response"}`);
};

const json = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

await waitFor(`${baseUrl}/functions/v1/send-message`);

const email = `edge-ci-${crypto.randomUUID()}@example.test`;
const signup = await fetch(`${baseUrl}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "Edge-function-ci-password-2026!" }),
});
assert.equal(signup.status, 200, "local Auth signup must issue a test session");
const session = await json(signup);
assert.equal(typeof session?.access_token, "string", "local Auth signup must return an access token");

const userHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${session.access_token}`,
  "Content-Type": "application/json",
};
const corsProbe = await fetch(`${baseUrl}/functions/v1/send-message`, {
  method: "OPTIONS",
  headers: { Origin: "http://localhost:5173" },
});
assert.equal(corsProbe.status, 200, "send-message must answer CORS preflight");
assert.ok(
  ["*", "http://localhost:5173"].includes(corsProbe.headers.get("access-control-allow-origin")),
  "the gateway must allow the configured local origin during CORS preflight",
);

const translationCorsProbe = await fetch(`${baseUrl}/functions/v1/translate-message`, {
  method: "OPTIONS",
  headers: { Origin: "http://localhost:5173" },
});
assert.equal(translationCorsProbe.status, 200, "translate-message must answer CORS preflight");
assert.match(
  translationCorsProbe.headers.get("access-control-allow-methods") ?? "",
  /POST/i,
  "translate-message preflight must allow POST",
);

const malformedSend = await fetch(`${baseUrl}/functions/v1/send-message`, {
  method: "POST",
  headers: { ...userHeaders, Origin: "http://localhost:5173" },
  body: JSON.stringify({ body: "short", seaId: "pacific", includeDate: true }),
});
assert.equal(malformedSend.status, 400, "send-message must enforce its JSON contract");
assert.equal((await json(malformedSend))?.error?.code, "INVALID_DRAFT");

const malformedDelete = await fetch(`${baseUrl}/functions/v1/delete-account`, {
  method: "POST",
  headers: userHeaders,
  body: JSON.stringify({ confirmation: "NO" }),
});
assert.equal(malformedDelete.status, 400, "delete-account must require explicit confirmation");
assert.equal((await json(malformedDelete))?.error?.code, "CONFIRMATION_REQUIRED");

const accountMergeCorsProbe = await fetch(`${baseUrl}/functions/v1/account-merge`, {
  method: "OPTIONS",
  headers: { Origin: "http://localhost:5173" },
});
assert.equal(accountMergeCorsProbe.status, 200, "account-merge must answer CORS preflight");
assert.match(
  accountMergeCorsProbe.headers.get("access-control-allow-methods") ?? "",
  /POST/i,
  "account-merge preflight must allow POST",
);

const malformedAccountMerge = await fetch(`${baseUrl}/functions/v1/account-merge`, {
  method: "POST",
  headers: userHeaders,
  body: JSON.stringify({ action: "start", provider: "google" }),
});
assert.equal(malformedAccountMerge.status, 400, "account-merge must reject unsupported providers");
assert.equal((await json(malformedAccountMerge))?.error?.code, "INVALID_REQUEST");

const malformedTranslation = await fetch(`${baseUrl}/functions/v1/translate-message`, {
  method: "POST",
  headers: userHeaders,
  body: JSON.stringify({ messageId: "not-a-uuid" }),
});
assert.equal(malformedTranslation.status, 400, "translate-message must validate the message identifier");
assert.equal((await json(malformedTranslation))?.error, "INVALID_REQUEST");

const dispatcher = await fetch(`${baseUrl}/functions/v1/dispatch-web-push`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-scheduled-job-secret": "wrong" },
  body: JSON.stringify({ batchSize: 1 }),
});
assert.equal(dispatcher.status, 401, "dispatcher must reject an invalid scheduler secret");
assert.equal(
  (await json(dispatcher))?.error,
  "AUTH_REQUIRED",
  "dispatcher must reach its own secret check instead of the platform JWT gate",
);

console.log("Verified Edge Function load, CORS, JWT, contract validation, and scheduler-secret guard.");
