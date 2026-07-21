import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@^1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const recordUsage = async (
  admin: Parameters<Parameters<typeof withSupabase>[1]>[1]["supabaseAdmin"],
  metric: "edge_function_invocations" | "translated_characters",
  quantity: number,
) => {
  await admin.rpc("record_service_usage", {
    p_service: metric === "translated_characters" ? "azure_translator" : "supabase",
    p_metric: metric,
    p_quantity: quantity,
  });
};

interface TranslationJob {
  job_id: string;
  message_id: string;
  body: string;
  source_language: string;
  target_language: string;
}

const completeJob = async (
  admin: Parameters<Parameters<typeof withSupabase>[1]>[1]["supabaseAdmin"],
  job: TranslationJob,
  workerId: string,
  outcome: "succeeded" | "retry" | "dead_letter",
  translatedBody: string | null,
  detail: string | null,
) => admin.rpc("ocean_complete_translation_job", {
  p_job_id: job.job_id,
  p_worker_id: workerId,
  p_outcome: outcome,
  p_translated_body: translatedBody,
  p_error: detail,
});

const processQueuedTranslations = async (
  admin: Parameters<Parameters<typeof withSupabase>[1]>[1]["supabaseAdmin"],
) => {
  const workerId = crypto.randomUUID();
  const { data, error } = await admin.rpc("ocean_claim_translation_jobs", {
    p_worker_id: workerId,
    p_batch_size: 10,
  });
  if (error) throw new Error("TRANSLATION_JOB_CLAIM_FAILED");
  const jobs = (data ?? []) as TranslationJob[];
  if (jobs.length === 0) return { processed: 0, configured: true };

  const azureKey = Deno.env.get("AZURE_TRANSLATOR_KEY");
  const azureRegion = Deno.env.get("AZURE_TRANSLATOR_REGION");
  const azureEndpoint = (Deno.env.get("AZURE_TRANSLATOR_ENDPOINT")
    ?? "https://api.cognitive.microsofttranslator.com").replace(/\/$/, "");
  if (!azureKey) {
    await Promise.all(jobs.map((job) => completeJob(
      admin,
      job,
      workerId,
      "retry",
      null,
      "TRANSLATION_NOT_CONFIGURED",
    )));
    return { processed: jobs.length, configured: false };
  }

  for (const job of jobs) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": azureKey,
    };
    if (azureRegion) headers["Ocp-Apim-Subscription-Region"] = azureRegion;
    try {
      const translationResponse = await fetch(
        `${azureEndpoint}/translate?api-version=3.0&textType=plain&from=${encodeURIComponent(job.source_language)}&to=${encodeURIComponent(job.target_language)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify([{ text: job.body }]),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!translationResponse.ok) {
        await completeJob(admin, job, workerId, "retry", null, `AZURE_${translationResponse.status}`);
        continue;
      }
      const translationPayload = await translationResponse.json() as Array<{
        translations?: Array<{ text?: string }>;
      }>;
      const translatedBody = translationPayload[0]?.translations?.[0]?.text?.trim();
      if (!translatedBody) {
        await completeJob(admin, job, workerId, "retry", null, "AZURE_EMPTY_RESPONSE");
        continue;
      }
      const { error: completionError } = await completeJob(
        admin,
        job,
        workerId,
        "succeeded",
        translatedBody,
        null,
      );
      if (completionError) continue;
      await recordUsage(admin, "translated_characters", Array.from(job.body).length).catch(() => undefined);
    } catch {
      await completeJob(admin, job, workerId, "retry", null, "AZURE_UNAVAILABLE");
    }
  }
  return { processed: jobs.length, configured: true };
};

const translateMessage = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const userId = String(context.jwtClaims?.sub ?? "");
  if (!userId) return json({ error: "AUTH_REQUIRED" }, 401);
  const admin = context.supabaseAdmin;
  await recordUsage(admin, "edge_function_invocations", 1).catch(() => undefined);

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

  const { error: enqueueError } = await admin.rpc("ocean_enqueue_translation", {
    p_message_id: messageId,
    p_target_language: targetLanguage,
  });
  if (enqueueError) return json({ error: "TRANSLATION_QUEUE_FAILED" }, 500);

  const result = await processQueuedTranslations(admin).catch(() => null);
  if (!result?.configured) return json({ error: "TRANSLATION_NOT_CONFIGURED" }, 503);
  return json({ translated: true, cached: false, queued: result.processed > 0 });
});

export default {
  fetch: (request: Request) => request.method === "OPTIONS"
    ? new Response("ok", { headers: corsHeaders })
    : translateMessage(request),
};
