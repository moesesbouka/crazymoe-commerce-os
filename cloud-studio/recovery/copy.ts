import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import {mediaManifest, validateRequest} from "./copy-manifest.mjs";

const reply = (value: unknown, status = 200) => Response.json(value, {status, headers: {"Cache-Control": "no-store"}});
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");

// Operator-only, short-lived read access to one hash-verified snapshot's exact media.
// No browser session, public API key, path supplied media, or write operation accepted.
Deno.serve(async req => {
  if (req.method !== "POST") return reply({error: "Method not allowed"}, 405);
  const token = req.headers.get("x-studio-worker") || "";
  if (token.length !== 72) return reply({error: "Unauthorized"}, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {auth: {persistSession: false, autoRefreshToken: false}});
  // Existing database check validates against Vault; length alone grants nothing.
  const auth = await admin.rpc("studio_backup_document", {p_token: token});
  if (auth.error) return reply({error: "Unauthorized"}, auth.error.code === "42501" ? 403 : 503);
  let input;
  try {
    const body = await req.text();
    if (body.length > 1024) return reply({error: "Request too large"}, 413);
    input = validateRequest(JSON.parse(body));
  } catch { return reply({error: "Invalid recovery request"}, 400); }
  const storage = admin.storage.from("studio-originals");
  try {
    const got = await storage.download(input.path);
    if (got.error || !got.data || got.data.size > 16 * 1024 * 1024) return reply({error: "Snapshot unavailable"}, 409);
    const bytes = await got.data.arrayBuffer();
    if (await digest(bytes) !== input.sha256) return reply({error: "Snapshot hash mismatch"}, 409);
    const doc = await new Response(got.data.stream().pipeThrough(new DecompressionStream("gzip"))).json();
    const objects = mediaManifest(doc);
    const signedObjects = [];
    for (let i = 0; i < objects.length; i += 100) {
      const batch = objects.slice(i, i + 100);
      const signed = await storage.createSignedUrls(batch.map(x => x.path), 900);
      if (signed.error || !signed.data || signed.data.length !== batch.length) throw Error("Signing failed");
      const urls = new Map(signed.data.map(x => [x.path, x.signedUrl]));
      for (const item of batch) {
        const url = urls.get(item.path);
        if (!url) throw Error("Signing failed");
        signedObjects.push({...item, url});
      }
    }
    const snapshot = await storage.createSignedUrl(input.path, 900);
    if (snapshot.error || !snapshot.data) throw Error("Signing failed");
    return reply({format: 1, expires_at: new Date(Date.now() + 900000).toISOString(),
      snapshot: {...input, bytes: bytes.byteLength, url: snapshot.data.signedUrl}, objects: signedObjects});
  } catch { return reply({error: "Recovery manifest unavailable"}, 503); }
});
