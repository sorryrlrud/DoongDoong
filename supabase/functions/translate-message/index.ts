import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const translateMessage = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const userId = String(context.jwtClaims?.sub ?? "");
  if (!userId) return json({ error: "AUTH_REQUIRED" }, 401);
  const admin = context.supabaseAdmin;

  let messageId: string | undefined;
  try {
    const payload = await request.json() as { messageId?: string };
    messageId = payload.messageId;
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  if (!messageId || !/^[0-9a-f-]{36}$/i.test(messageId)) return json({ error: "INVALID_REQUEST" }, 400);

  const [{ data: profile, error: profileError }, { data: message, error: messageError }] = await Promise.all([
    admin.from("users").select("language_code").eq("id", userId).single(),
    admin
      .from("messages")
      .select("id, body, source_language, reserved_to, status")
      .eq("id", messageId)
      .single(),
  ]);

  if (profileError || !profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
  if (
    messageError
    || !message
    || message.reserved_to !== userId
    || !["delivered", "kept"].includes(message.status)
  ) return json({ error: "MESSAGE_NOT_AVAILABLE" }, 404);

  const targetLanguage = profile.language_code as string;
  const sourceLanguage = message.source_language as string;
  if (sourceLanguage === targetLanguage) return json({ translated: false, reason: "same-language" });

  const { data: cached } = await admin
    .from("message_translations")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("target_language", targetLanguage)
    .maybeSingle();
  if (cached) return json({ translated: true, cached: true });

  const azureKey = Deno.env.get("AZURE_TRANSLATOR_KEY");
  const azureRegion = Deno.env.get("AZURE_TRANSLATOR_REGION");
  const azureEndpoint = (Deno.env.get("AZURE_TRANSLATOR_ENDPOINT")
    ?? "https://api.cognitive.microsofttranslator.com").replace(/\/$/, "");
  if (!azureKey) return json({ error: "TRANSLATION_NOT_CONFIGURED" }, 503);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": azureKey,
  };
  if (azureRegion) headers["Ocp-Apim-Subscription-Region"] = azureRegion;

  const translationResponse = await fetch(
    `${azureEndpoint}/translate?api-version=3.0&textType=plain&from=${encodeURIComponent(sourceLanguage)}&to=${encodeURIComponent(targetLanguage)}`,
    { method: "POST", headers, body: JSON.stringify([{ text: message.body }]) },
  );
  if (!translationResponse.ok) return json({ error: "TRANSLATION_FAILED" }, 502);

  const translationPayload = await translationResponse.json() as Array<{
    translations?: Array<{ text?: string }>;
  }>;
  const translatedBody = translationPayload[0]?.translations?.[0]?.text?.trim();
  if (!translatedBody) return json({ error: "TRANSLATION_FAILED" }, 502);

  const { error: cacheError } = await admin.from("message_translations").upsert({
    message_id: messageId,
    source_language: sourceLanguage,
    target_language: targetLanguage,
    translated_body: translatedBody,
    provider: "azure",
  }, { onConflict: "message_id,target_language", ignoreDuplicates: true });

  if (cacheError) return json({ error: "CACHE_WRITE_FAILED" }, 500);
  return json({ translated: true, cached: false });
});

export default {
  fetch: (request: Request) => request.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders })
    : translateMessage(request),
};
