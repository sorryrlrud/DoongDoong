import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";

const productionOrigins = new Set([
  "https://sorryrlrud.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const corsHeaders = (request: Request): HeadersInit => {
  const requestOrigin = request.headers.get("origin");
  const configuredOrigins = Deno.env.get("ALLOWED_WEB_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins?.length ? new Set(configuredOrigins) : productionOrigins;
  const allowedOrigin = requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : "https://sorryrlrud.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
};

const response = (request: Request, body: unknown, status = 200) => new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: corsHeaders(request) },
);

const failure = (request: Request, requestId: string, code: string, status: number) => response(request, {
  error: {
    code,
    message: "The account could not be deleted.",
    retryable: code === "ACCOUNT_DELETE_FAILED",
    requestId,
  },
}, status);

const deleteAccount = withSupabase({ auth: "user" }, async (request, context) => {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return failure(request, requestId, "CONFIRMATION_REQUIRED", 405);
  const userId = String(context.jwtClaims?.sub ?? "");
  if (!userId) return failure(request, requestId, "AUTH_REQUIRED", 401);

  let confirmation: unknown;
  try {
    confirmation = (await request.json() as { confirmation?: unknown }).confirmation;
  } catch {
    return failure(request, requestId, "CONFIRMATION_REQUIRED", 400);
  }
  if (confirmation !== "DELETE") return failure(request, requestId, "CONFIRMATION_REQUIRED", 400);

  // Supabase does not retain generic provider refresh grants in a form that an
  // Edge Function can revoke reliably. The transaction below removes local
  // identity/session data first; provider-side revocation is only attempted
  // when a provider integration explicitly supports it.
  const { error: dataError } = await context.supabaseAdmin.rpc("ocean_delete_account_data", {
    p_user_id: userId,
  });
  if (dataError) {
    const message = dataError.message ?? "";
    if (message.includes("ACCOUNT_DELETE_IN_PROGRESS")) {
      return failure(request, requestId, "ACCOUNT_DELETE_IN_PROGRESS", 409);
    }
    if (message.includes("AUTH_REQUIRED") || message.includes("ACCOUNT_DELETED")) {
      return failure(request, requestId, "AUTH_REQUIRED", 401);
    }
    return failure(request, requestId, "ACCOUNT_DELETE_FAILED", 500);
  }

  const { error: authError } = await context.supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError) {
    // Data anonymization is intentionally idempotent. A retry can finish Auth
    // deletion without restoring any private profile or subscription data.
    return failure(request, requestId, "ACCOUNT_DELETE_FAILED", 500);
  }
  return response(request, null, 204);
});

export default {
  fetch: (request: Request) => request.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders(request) })
    : deleteAccount(request),
};
