import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";

type ErrorCode =
  | "INVALID_DRAFT"
  | "AUTH_REQUIRED"
  | "ACCOUNT_INACTIVE"
  | "CONTENT_REJECTED"
  | "RATE_LIMITED"
  | "DAILY_LIMIT"
  | "MODERATION_UNAVAILABLE";

class ContractError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(code);
  }
}

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

const failure = (
  request: Request,
  requestId: string,
  code: ErrorCode,
  status: number,
  retryable = false,
) => response(request, {
  error: {
    code,
    // Clients map this stable code to a localized message. Do not surface provider
    // or database error details to a sender.
    message: "The message could not be sent.",
    retryable,
    requestId,
  },
}, status);

interface SendMessageInput {
  body: string;
  seaId: string;
  signature?: string;
  includeDate: boolean;
}

const seaIds = new Set(["pacific", "atlantic", "indian", "arctic", "southern"]);

const readInput = async (request: Request): Promise<SendMessageInput> => {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ContractError("INVALID_DRAFT", 400);
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError("INVALID_DRAFT", 400);
  }
  const input = value as Record<string, unknown>;
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const seaId = typeof input.seaId === "string" ? input.seaId : "";
  const signature = typeof input.signature === "string" ? input.signature.trim() : undefined;

  if (
    body.length < 10
    || body.length > 1000
    || !seaIds.has(seaId)
    || (signature !== undefined && (signature.length < 1 || signature.length > 20))
    || typeof input.includeDate !== "boolean"
  ) {
    throw new ContractError("INVALID_DRAFT", 400);
  }
  return { body, seaId, signature, includeDate: input.includeDate };
};

// This intentionally errs on the conservative side. It is a deterministic
// pre-filter only; the managed moderation provider below remains authoritative.
const deterministicContentRejected = (body: string): boolean => {
  const normalized = body.normalize("NFKC").toLowerCase();
  const contactPatterns = [
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    /(?:https?:\/\/|www\.)\S+/i,
    /(?:^|\s)(?:\+?\d[\d\s().-]{7,}\d)(?:\s|$)/,
    /(?:카카오톡|kakaotalk|telegram|텔레그램|line\s*id|디스코드|discord)\s*[:#@]?[\w.-]+/i,
  ];
  const coerciveOrAbusivePatterns = [
    /(?:kill\s+yourself|자살해|죽어버려|죽어라)/i,
    /(?:nudes?|성관계\s*하자|만나서\s*(?:자|보자))/i,
    /(?:free\s+(?:money|crypto)|투자\s*보장|대출\s*광고)/i,
  ];
  const repeatedRun = /(.)\1{12,}/u;
  return [...contactPatterns, ...coerciveOrAbusivePatterns].some((pattern) => pattern.test(normalized))
    || repeatedRun.test(normalized);
};

const parseModerationVerdict = (payload: unknown): boolean | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const result = payload as Record<string, unknown>;
  if (typeof result.flagged === "boolean") return !result.flagged;
  if (typeof result.allowed === "boolean") return result.allowed;
  if (Array.isArray(result.results) && typeof result.results[0] === "object" && result.results[0] !== null) {
    const first = result.results[0] as Record<string, unknown>;
    if (typeof first.flagged === "boolean") return !first.flagged;
  }
  if (typeof result.verdict === "string") {
    const verdict = result.verdict.toLowerCase();
    if (["allow", "allowed", "safe", "pass"].includes(verdict)) return true;
    if (["block", "blocked", "reject", "rejected", "unsafe"].includes(verdict)) return false;
  }
  return null;
};

const moderate = async (body: string, signature: string | undefined, userId: string): Promise<void> => {
  // The signature is rendered beside the message and is therefore UGC too.
  // Always send the complete recipient-visible content through both safety
  // layers so a short contact address cannot bypass body-only checks.
  const moderationInput = signature ? `${body}\n\nSignature: ${signature}` : body;
  if (deterministicContentRejected(moderationInput)) throw new ContractError("CONTENT_REJECTED", 422);

  const endpoint = Deno.env.get("MODERATION_ENDPOINT");
  const apiKey = Deno.env.get("MODERATION_API_KEY");
  if (!endpoint || !apiKey) {
    console.error("Managed moderation is not configured");
    throw new ContractError("MODERATION_UNAVAILABLE", 503, true);
  }

  try {
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(7_000),
      body: JSON.stringify({ input: moderationInput, user: userId }),
    });
    if (!result.ok) {
      console.error("Managed moderation returned a non-success status", result.status);
      throw new Error(`moderation ${result.status}`);
    }
    const allowed = parseModerationVerdict(await result.json());
    // A provider response that cannot be interpreted is an outage, not an allow.
    if (allowed === null) throw new Error("unrecognized moderation response");
    if (!allowed) throw new ContractError("CONTENT_REJECTED", 422);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    // Provider details never reach the client, but a compact operational log
    // is necessary to distinguish an outage from a deliberately blocked draft.
    console.error("Managed moderation request failed", error instanceof Error ? error.message : "unknown error");
    throw new ContractError("MODERATION_UNAVAILABLE", 503, true);
  }
};

const errorFromRpc = (error: unknown): ContractError => {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
  if (message.includes("DAILY_LIMIT")) return new ContractError("DAILY_LIMIT", 429);
  if (message.includes("RATE_LIMITED")) return new ContractError("RATE_LIMITED", 429, true);
  if (message.includes("ACCOUNT_INACTIVE") || message.includes("SOCIAL_AUTH_REQUIRED")) {
    return new ContractError("ACCOUNT_INACTIVE", 403);
  }
  if (message.includes("AUTH_REQUIRED") || message.includes("ACCOUNT_DELETED")) {
    return new ContractError("AUTH_REQUIRED", 401);
  }
  return new ContractError("INVALID_DRAFT", 400);
};

const recordModerationAudit = async (
  admin: Parameters<Parameters<typeof withSupabase>[1]>[1]["supabaseAdmin"],
  actorUserId: string,
  decision: "accepted" | "rejected" | "unavailable",
  requestId: string,
) => {
  // Audit recording must never turn a provider decision into an accidental
  // allow. The production database grants this RPC only to the service role.
  try {
    await admin.rpc("ocean_record_moderation_audit", {
      p_actor_user_id: actorUserId,
      p_provider: decision === "rejected" ? "deterministic-or-managed" : "managed",
      p_decision: decision,
      p_request_id: requestId,
    });
  } catch {
    // The moderation outcome remains authoritative even if audit persistence
    // is temporarily unavailable.
  }
};

const sendMessage = withSupabase({ auth: "user" }, async (request, context) => {
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return failure(request, requestId, "INVALID_DRAFT", 405);
  const userId = String(context.jwtClaims?.sub ?? "");
  if (!userId) return failure(request, requestId, "AUTH_REQUIRED", 401);

  try {
    const input = await readInput(request);
    // Lock a rate-limit slot before a provider call. This prevents concurrent
    // over-limit requests from consuming moderation capacity.
    const { error: rateLimitError } = await context.supabaseAdmin.rpc("ocean_reserve_send_attempt", {
      p_actor_user_id: userId,
    });
    if (rateLimitError) throw errorFromRpc(rateLimitError);
    try {
      await moderate(input.body, input.signature, userId);
      await recordModerationAudit(context.supabaseAdmin, userId, "accepted", requestId);
    } catch (error) {
      if (error instanceof ContractError) {
        await recordModerationAudit(
          context.supabaseAdmin,
          userId,
          error.code === "CONTENT_REJECTED" ? "rejected" : "unavailable",
          requestId,
        );
      }
      throw error;
    }
    const { data, error } = await context.supabaseAdmin.rpc("ocean_trusted_send", {
      p_actor_user_id: userId,
      p_body: input.body,
      p_sea_id: input.seaId,
      p_signature: input.signature ?? null,
      p_include_date: input.includeDate,
    });
    if (error) throw errorFromRpc(error);
    return response(request, { snapshot: data });
  } catch (error) {
    if (!(error instanceof ContractError)) {
      console.error("send-message unexpected failure", error instanceof Error ? error.message : "unknown error");
    }
    const contractError = error instanceof ContractError
      ? error
      : new ContractError("MODERATION_UNAVAILABLE", 503, true);
    return failure(
      request,
      requestId,
      contractError.code,
      contractError.status,
      contractError.retryable,
    );
  }
});

export default {
  fetch: (request: Request) => request.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders(request) })
    : sendMessage(request),
};
