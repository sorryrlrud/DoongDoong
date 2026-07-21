import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";
import webPush from "npm:web-push@3.6.7";

interface Delivery {
  delivery_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  notification_id: string;
  payload: Record<string, unknown>;
}

type CompletionOutcome = "sent" | "retry" | "disable" | "dead_letter";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

const equalSecret = (provided: string, expected: string): boolean => {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
};

const authorized = (request: Request): boolean => {
  const expected = Deno.env.get("SCHEDULED_JOB_SECRET") ?? "";
  const supplied = request.headers.get("x-scheduled-job-secret")
    ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  return equalSecret(supplied, expected);
};

const statusCode = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null) return null;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  if ("status" in error && typeof error.status === "number") return error.status;
  return null;
};

const errorText = (error: unknown): string => error instanceof Error ? error.message.slice(0, 500) : "push delivery failed";

const batchSize = async (request: Request): Promise<number> => {
  if (!request.headers.get("content-type")?.includes("application/json")) return 100;
  try {
    const body = await request.json() as { batchSize?: unknown };
    const parsed = typeof body.batchSize === "number" ? Math.trunc(body.batchSize) : 100;
    return Math.min(Math.max(parsed, 1), 100);
  } catch {
    return 100;
  }
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorized(request)) return json({ error: "AUTH_REQUIRED" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:operations@doongdoong.app";
  if (!url || !serviceRoleKey) {
    return json({ error: "DISPATCH_NOT_CONFIGURED" }, 503);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const workerId = crypto.randomUUID();
  const limit = await batchSize(request);
  // Assignment is intentionally independent of Push configuration and
  // preferences. The same scheduled invocation advances bounded lifecycle
  // work, assigns due bottles, then (when configured) drains the outbox.
  const { error: lifecycleError } = await admin.rpc("ocean_run_lifecycle", {
    p_batch_size: limit,
  });
  if (lifecycleError) return json({ error: "LIFECYCLE_ADVANCE_FAILED" }, 500);
  const { error: assignmentError } = await admin.rpc("ocean_assign_due_messages", {
    p_batch_size: limit,
  });
  if (assignmentError) return json({ error: "ASSIGNMENT_FAILED" }, 500);

  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "PUSH_NOT_CONFIGURED" }, 503);
  }
  const { data, error } = await admin.rpc("ocean_claim_notification_deliveries", {
    p_worker_id: workerId,
    p_batch_size: limit,
  });
  if (error) return json({ error: "OUTBOX_CLAIM_FAILED" }, 500);
  const deliveries = (data ?? []) as Delivery[];

  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const result = { claimed: deliveries.length, sent: 0, retried: 0, disabledSubscriptions: 0, failed: 0 };

  for (const delivery of deliveries) {
    let outcome: CompletionOutcome = "retry";
    let deliveryStatus: number | null = null;
    let detail: string | null = null;
    try {
      const pushResult = await webPush.sendNotification({
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      }, JSON.stringify(delivery.payload), { TTL: 60 * 60, urgency: "normal" });
      deliveryStatus = pushResult.statusCode;
      if (deliveryStatus === 201 || deliveryStatus === 202) {
        outcome = "sent";
        result.sent += 1;
      } else if (deliveryStatus === 404 || deliveryStatus === 410) {
        outcome = "disable";
        result.disabledSubscriptions += 1;
      } else if (deliveryStatus >= 400 && deliveryStatus < 500) {
        outcome = "dead_letter";
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    } catch (error) {
      deliveryStatus = statusCode(error);
      detail = errorText(error);
      if (deliveryStatus === 404 || deliveryStatus === 410) {
        outcome = "disable";
        result.disabledSubscriptions += 1;
      } else if (deliveryStatus !== null && deliveryStatus >= 400 && deliveryStatus < 500 && deliveryStatus !== 429) {
        outcome = "dead_letter";
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    }
    const { error: completionError } = await admin.rpc("ocean_complete_notification_delivery", {
      p_delivery_id: delivery.delivery_id,
      p_worker_id: workerId,
      p_outcome: outcome,
      p_status_code: deliveryStatus,
      p_error: detail,
    });
    // Do not acknowledge a worker cycle when a lease could not be completed:
    // that hides an eventual retry/duplicate from operations.
    if (completionError) return json({ error: "OUTBOX_COMPLETION_FAILED" }, 500);
  }
  return json(result);
});
