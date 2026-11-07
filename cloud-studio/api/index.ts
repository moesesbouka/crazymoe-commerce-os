import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const origins = new Set(["https://studio.crazymoe.com", "https://crazymoe-marketplace-studio.vercel.app", "https://crazymoe-marketplace-studio-moe-boukas-projects.vercel.app"]);
function jpegDimensions(bytes: Uint8Array): {width:number,height:number}|null {
  let offset=2;
  while(offset+4<=bytes.length){
    if(bytes[offset++]!==255)return null;
    let marker=bytes[offset++];while(marker===255 && offset<bytes.length)marker=bytes[offset++];
    if(marker===217||marker===218)return null;
    if(marker===216||marker===1||(marker>=208&&marker<=215))continue;
    const length=(bytes[offset]<<8)|bytes[offset+1];if(length<2||offset+length>bytes.length)return null;
    if([192,193,194].includes(marker)){if(length<8)return null;return {height:(bytes[offset+3]<<8)|bytes[offset+4],width:(bytes[offset+5]<<8)|bytes[offset+6]};}
    offset+=length;
  }
  return null;
}
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
    : error.code === "42501" ? "Studio access denied" : /^(Complete listing fields|Price must|Remove internal|Listing photos|Selected|No verified|Prepare existing|Photo count|Too many|Invalid photo|Listing changed|Product cannot)/.test((error as {message?:string}).message||"") ? (error as {message:string}).message : "Request could not be completed" },
    error.code === "40001" ? 409 : error.code === "42501" ? 403 : 400);
  try {
    if (path === "inventory" && req.method === "GET") {
      const result = await client.rpc("studio_state");
      if (result.error) return failure(result.error);
      return reply({ items: result.data, migration_preview: true });
    }
    if (path === "intake" && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 8192) return reply({error:"Manifest too large"},413);
      const {batch, files} = JSON.parse(raw);
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(batch)
        || !Array.isArray(files) || files.length < 1 || files.length > 10) return reply({error:"Invalid upload batch"},400);
      const admin = createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
      const userId = verified.data.user.id;
      const checked = [];
      for (const file of files) {
        if (!/^[a-f0-9]{64}$/.test(file.sha) || typeof file.name !== "string" || file.name.length > 255
          || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 16*1024*1024) return reply({error:"Invalid photo"},400);
        const object = await admin.storage.from("studio-originals").download("incoming/"+userId+"/"+batch+"/"+file.sha);
        if (object.error || !object.data || object.data.size !== file.bytes) return reply({error:"Original missing or incomplete"},409);
        const bytes = new Uint8Array(await object.data.arrayBuffer());
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)), b => b.toString(16).padStart(2,"0")).join("");
        if (digest !== file.sha) return reply({error:"Photo verification failed"},409);
        const jpg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
        const png = bytes[0]===137 && String.fromCharCode(...bytes.slice(1,4))==="PNG";
        const webp = String.fromCharCode(...bytes.slice(0,4))==="RIFF" && String.fromCharCode(...bytes.slice(8,12))==="WEBP";
        if (!jpg && !png && !webp) return reply({error:"Use JPEG, PNG or WebP photos"},415);
        if (!checked.some(existing => existing.sha === digest)) checked.push({sha:digest,name:file.name,bytes:bytes.length});
      }
      const result = await admin.rpc("studio_finish_intake",{p_user:userId,p_batch:batch,p_files:checked});
      if (result.error) return failure(result.error);
      return reply({id:result.data});
    }
    if (path === "add-photo" && req.method === "POST") {
      const raw = await req.text();
      if (raw.length > 8192) return reply({error:"Photo metadata too large"},413);
      const {id,batch,sha,bytes,width,height,name,kind,photo_revision,source_url,reference_id,original} = JSON.parse(raw);
      if (typeof id!=="string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)
        || !/^[a-f0-9-]{36}$/.test(batch) || !/^[a-f0-9]{64}$/.test(sha)
        || !Number.isSafeInteger(bytes) || bytes<500 || bytes>16000000
        || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width<100 || width>4096 || height<100 || height>4096
        || !Number.isSafeInteger(photo_revision) || photo_revision<1
        || !["real","manufacturer"].includes(kind)
        || typeof name!=="string" || name.length>255
        || (source_url && (typeof source_url!=="string" || source_url.length>2048))) {
        return reply({error:"Invalid photo upload metadata"},400);
      }
      if(reference_id){
        if(kind!=="manufacturer" || typeof reference_id!=="string" || !/^[a-z0-9-]{5,100}$/.test(reference_id))return reply({error:"Invalid reference"},400);
        const access=await client.rpc("studio_reference_access",{p_item:id,p_reference:reference_id});
        if(access.error||!access.data)return reply({error:"Reference unavailable for this product"},403);
      }
      const admin = createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
      let originalReceipt=null;
      if(original){
        if(!/^[a-f0-9]{64}$/.test(original.sha)||!Number.isSafeInteger(original.bytes)||original.bytes<1||original.bytes>16000000)return reply({error:"Invalid original"},400);
        const path="incoming/"+verified.data.user.id+"/"+batch+"/"+original.sha;
        const source=await admin.storage.from("studio-originals").download(path);
        if(source.error||!source.data||source.data.size!==original.bytes)return reply({error:"Original missing"},409);
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await source.data.arrayBuffer())),v=>v.toString(16).padStart(2,"0")).join("");
        if(hash!==original.sha)return reply({error:"Original failed checksum"},409);
        originalReceipt={...original,path};
      }
      const from = "incoming/"+verified.data.user.id+"/"+batch+"/"+sha;
      const uploaded = await admin.storage.from("studio-originals").download(from);
      if (uploaded.error || !uploaded.data || uploaded.data.size!==bytes) return reply({error:"Uploaded photo missing"},409);
      const fileBytes = new Uint8Array(await uploaded.data.arrayBuffer());
      if (fileBytes[0]!==255 || fileBytes[1]!==216 || fileBytes[2]!==255) return reply({error:"Converted JPEG required"},415);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",fileBytes)),v=>v.toString(16).padStart(2,"0")).join("");
      if (digest!==sha) return reply({error:"Photo failed checksum"},409);
      const dimensions=jpegDimensions(fileBytes);
      if(!dimensions||dimensions.width!==width||dimensions.height!==height)return reply({error:"JPEG dimensions do not match"},415);
      const target="exports/"+sha;
      const existing=await admin.storage.from("studio-originals").info(target);
      if (existing.error) {
        const copied=await admin.storage.from("studio-originals").copy(from,target);
        if (copied.error) return reply({error:"Unable to prepare photo"},503);
      }
      const stored=await admin.storage.from("studio-originals").download(target);
      if(stored.error||!stored.data||stored.data.size!==bytes)return reply({error:"Prepared photo missing"},503);
      const storedHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await stored.data.arrayBuffer())),v=>v.toString(16).padStart(2,"0")).join("");
      if(storedHash!==sha)return reply({error:"Stored photo failed verification"},409);
      const result=await admin.rpc("studio_append_manual_photo",{
        p_user:verified.data.user.id,p_item:id,p_expected_photo_revision:photo_revision,p_kind:kind,
        p_file:{sha,bytes,width,height,name,source_url:source_url||"",...(reference_id?{reference_id}:{}),...(originalReceipt?{original:originalReceipt}:{})}
      });
      if (result.error) return failure(result.error);
      return reply(result.data);
    }
    if (path === "export-preview" && req.method === "POST") {
      const {id,revision} = await req.json();
      const result = await client.rpc("studio_export_preview",{p_item:id,p_revision:revision});
      if (result.error) return failure(result.error);
      const admin = createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
      const paths = result.data.images.map((image:{sha:string}) => "exports/"+image.sha);
      const signed = await admin.storage.from("studio-originals").createSignedUrls(paths,180);
      if (signed.error || signed.data.some(entry => !entry.signedUrl)) return reply({error:"JPEG preview unavailable"},503);
      return reply({snapshot:result.data,urls:signed.data.map(entry=>entry.signedUrl)});
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
    const reference = path.match(/^reference\/([A-Za-z0-9_-]{1,100})\/([a-z0-9-]{5,100})$/);
    if ((photo || reference) && req.method === "GET") {
      // Membership and verification are checked using the user's JWT before
      // the service credential can sign access to exactly this asset.
      const access = reference ? await client.rpc("studio_reference_access",{p_item:reference[1],p_reference:reference[2]}) : await client.rpc("studio_asset_access", { p_sha: photo![1] });
      if (access.error) return failure(access.error);
      if (!access.data) return reply({ error: "Verified photo unavailable" }, 404);
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signed = await admin.storage.from(access.data.bucket).createSignedUrl(access.data.path, 300);
      if (signed.error) return reply({ error: "Photo unavailable" }, 503);
      return reply({ url: signed.data.signedUrl, expires_in: 300, sha256: access.data.sha256 });
    }
    return reply({ error: "Endpoint not available" }, 404);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? "Invalid JSON" : "Request failed" }, 400);
  }
});
