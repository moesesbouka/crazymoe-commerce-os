import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const origins = new Set(["https://studio.crazymoe.com"]);
const methods = "GET, PATCH, POST, OPTIONS";
const baseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { ...baseHeaders };
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (origin && !origins.has(origin)) return reply({ error: "Origin not permitted" }, 403);
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  if (req.method === "OPTIONS") {
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type";
    return new Response(null, { status: 204, headers });
  }
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply({ error: "Sign in required" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.getUser(authorization.slice(7));
  if (verified.error || !verified.data.user) return reply({ error: "Session invalid or expired" }, 401);
  const path = new URL(req.url).pathname.replace(/^.*\/studio-api\/?/, "");
  const failure = (error: { code?: string }) => reply({ error: error.code === "40001"
    ? "This listing changed. Refresh before saving."
    : error.code === "42501" ? "Studio access denied" : "Request could not be completed" },
    error.code === "40001" ? 409 : error.code === "42501" ? 403 : 400);
  try {
    if (path === "inventory" && req.method === "GET") {
      const result = await client.rpc("studio_state");
      if (result.error) return failure(result.error);
      return reply({ items: result.data, migration_preview: true });
    }
    const item = path.match(/^inventory\/([A-Za-z0-9_-]{1,100})(\/rollback)?$/);
    if (item && ((req.method === "PATCH" && !item[2]) || (req.method === "POST" && item[2]))) {
      const raw = await req.text();
      if (raw.length > 65536) return reply({ error: "Request too large" }, 413);
      const body = JSON.parse(raw);
      if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1) {
        return reply({ error: "A current listing revision is required" }, 400);
      }
      const result = item[2]
        ? await client.rpc("studio_rollback", { p_id: item[1], p_expected_revision: body.expected_revision, p_event: body.event_id })
        : await client.rpc("studio_seller_patch", { p_id: item[1], p_expected_revision: body.expected_revision, p_patch: body.fields });
      if (result.error) return failure(result.error);
      return reply(result.data);
    }
    const photo = path.match(/^photo\/([a-f0-9]{64})$/);
    if (photo && req.method === "GET") {
      // Membership and verification are checked using the user's JWT before
      // the service credential can sign access to exactly this asset.
      const access = await client.rpc("studio_asset_access", { p_sha: photo[1] });
      if (access.error) return failure(access.error);
      if (!access.data) return reply({ error: "Verified photo unavailable" }, 404);
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = await admin.storage.from(access.data.bucket).createSignedUrl(access.data.path, 60);
      if (signed.error) return reply({ error: "Photo unavailable" }, 503);
      return reply({ url: signed.data.signedUrl, expires_in: 60, sha256: photo[1] });
    }
    return reply({ error: "Endpoint not available" }, 404);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? "Invalid JSON" : "Request failed" }, 400);
  }
});
