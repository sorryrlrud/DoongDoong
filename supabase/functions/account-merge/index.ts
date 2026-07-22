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
  const allowedOrigin = requestOrigin && allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : "https://sorryrlrud.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
};

const response = (request: Request, body: unknown, status = 200) => new Response(
  JSON.stringify(body), { status, headers: corsHeaders(request) },
);

const failure = (request: Request, requestId: string, code: string, status: number) => response(request, {
  error: {
    code,
    message: "The accounts could not be merged.",
    retryable: status >= 500,
    requestId,
  },
}, status);

const isUuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const errorResponse = (request: Request, requestId: string, error: { message?: string | null }) => {
  const message = error.message ?? "";
  if (message.includes("ACCOUNT_MERGE_EXPIRED")) return failure(request, requestId, "ACCOUNT_MERGE_EXPIRED", 409);
  if (message.includes("ACTIVE_BOTTLE_CONFLICT")) return failure(request, requestId, "ACTIVE_BOTTLE_CONFLICT", 409);
  if (message.includes("ACCOUNT_INACTIVE")) return failure(request, requestId, "ACCOUNT_INACTIVE", 409);
  if (message.includes("ADMIN_ACCOUNT")) return failure(request, requestId, "ADMIN_ACCOUNT", 409);
  if (message.includes("AUTH_REQUIRED")) return failure(request, requestId, "AUTH_REQUIRED", 401);
  return failure(request, requestId, "ACCOUNT_MERGE_FAILED", 500);
};

const accountMerge = withSupabase({ auth: "user" }, async (request, context) => {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return failure(request, requestId, "METHOD_NOT_ALLOWED", 405);

  const userId = String(context.jwtClaims?.sub ?? "");
  if (!isUuid(userId)) return failure(request, requestId, "AUTH_REQUIRED", 401);

  let body: { action?: unknown; provider?: unknown; intentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure(request, requestId, "INVALID_REQUEST", 400);
  }

  if (body.action === "start") {
    if (body.provider !== "naver") return failure(request, requestId, "INVALID_REQUEST", 400);
    const { data, error } = await context.supabaseAdmin.rpc("ocean_start_account_merge", {
      p_primary_user_id: userId,
      p_provider: "custom:naver",
    });
    return error ? errorResponse(request, requestId, error) : response(request, data);
  }

  if (!isUuid(body.intentId)) return failure(request, requestId, "INVALID_REQUEST", 400);
  if (body.action === "preview") {
    const { data, error } = await context.supabaseAdmin.rpc("ocean_preview_account_merge", {
      p_intent_id: body.intentId,
      p_source_user_id: userId,
    });
    return error ? errorResponse(request, requestId, error) : response(request, data);
  }
  if (body.action === "complete") {
    const { data, error } = await context.supabaseAdmin.rpc("ocean_complete_account_merge", {
      p_intent_id: body.intentId,
      p_source_user_id: userId,
    });
    return error ? errorResponse(request, requestId, error) : response(request, data);
  }
  if (body.action === "cancel") {
    const { error } = await context.supabaseAdmin.rpc("ocean_cancel_account_merge", {
      p_intent_id: body.intentId,
      p_actor_user_id: userId,
    });
    return error ? errorResponse(request, requestId, error) : response(request, { ok: true });
  }
  return failure(request, requestId, "INVALID_REQUEST", 400);
});

export default {
  fetch: (request: Request) => request.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders(request) })
    : accountMerge(request),
};
