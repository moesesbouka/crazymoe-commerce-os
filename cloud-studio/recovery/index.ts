import {createClient} from "npm:@supabase/supabase-js@2.119.0";

async function digest(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async req=>{
  if(req.method!=="POST") return new Response(null,{status:405});
  const token=req.headers.get("x-studio-worker")||"";
  if(token.length!==72) return new Response(null,{status:401});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const saved=await admin.rpc("studio_backup_document",{p_token:token});
  if(saved.error) return new Response(null,{status:saved.error.code==="42501"?403:503});
  const storage=admin.storage.from("studio-originals");
  const bytes=await new Response(new Blob([JSON.stringify(saved.data)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const checksum=await digest(bytes);
  const path="recovery/"+new Date().toISOString().slice(0,10)+"/"+crypto.randomUUID()+".json.gz";
  const upload=await storage.upload(path,bytes,{contentType:"application/gzip",upsert:false});
  if(upload.error) return Response.json({stage:"write"}, {status:503});
  const get=await storage.download(path);
  if(get.error || !get.data || await digest(await get.data.arrayBuffer())!==checksum)
    return Response.json({stage:"download_verification"},{status:503});
  const restored=await new Response(get.data.stream().pipeThrough(new DecompressionStream("gzip"))).json();
  const drill=await admin.rpc("studio_rehearse_backup",{p_token:token,p_document:restored});
  if(drill.error) return Response.json({stage:"restore",code:drill.error.code},{status:503});
  const receipt=await admin.rpc("studio_record_backup",{p_path:path,p_sha:checksum,p_bytes:bytes.byteLength,p_counts:drill.data});
  return Response.json({verified:!receipt.error,stage:"receipt"},{status:receipt.error?503:200});
});
