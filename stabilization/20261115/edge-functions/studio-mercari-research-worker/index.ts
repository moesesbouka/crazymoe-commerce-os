import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 65_536) return reply(413, { error: "PAYLOAD_TOO_LARGE" });

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (token.length !== 64 || /\s/.test(token)) return reply(401, { error: "UNAUTHORIZED" });

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return reply(413, { error: "PAYLOAD_TOO_LARGE" });
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return reply(400, { error: "INVALID_JSON" });
  }

  const action = body.action;
  if (action !== "claim" && action !== "finish") {
    return reply(400, { error: "INVALID_ACTION" });
  }
  if (action === "finish" && (!isUuid(body.id) || !isUuid(body.lease))) {
    return reply(400, { error: "INVALID_LEASE" });
  }
  if (action === "finish" && (typeof body.result !== "object" || body.result === null || Array.isArray(body.result))) {
    return reply(400, { error: "INVALID_RESULT" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return reply(503, { error: "SERVICE_UNAVAILABLE" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/studio_mercari_research_work`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_token: token,
        p_action: action,
        p_id: action === "finish" ? body.id : null,
        p_lease: action === "finish" ? body.lease : null,
        p_result: action === "finish" ? body.result : {},
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) return reply(response.status === 401 ? 401 : 502, { error: "WORKER_REQUEST_FAILED" });
    try {
      return reply(200, JSON.parse(responseText));
    } catch {
      return reply(502, { error: "INVALID_WORKER_RESPONSE" });
    }
  } catch {
    return reply(504, { error: "WORKER_TIMEOUT" });
  } finally {
    clearTimeout(timeout);
  }
});
