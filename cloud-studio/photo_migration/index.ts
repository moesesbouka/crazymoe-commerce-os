import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import config from "./migration-config.json" with { type: "json" };
const TOKEN_HASH=config.token_sha256;
const EXPIRES_AT=config.expires_at;
const ALLOWED:Record<string,number>=config.allowed;
const BUCKET="studio-originals";
const encoder=new TextEncoder();
async function digest(bytes:Uint8Array|ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");}
function response(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
Deno.serve(async req=>{
 if(Date.now()>EXPIRES_AT)return response({error:"Migration window closed"},410);
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 const token=req.headers.get("x-import-token")||"";
 if(token.length!==64||await digest(encoder.encode(token))!==TOKEN_HASH)return response({error:"Unauthorized"},401);
 const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
 const url=new URL(req.url);
 const closed=await client.storage.from(BUCKET).download("_migration/closed.json");
 if(closed.data)return response({error:"Migration window closed"},410);
 if(url.pathname.endsWith("/close")){
  const listed=await client.storage.from(BUCKET).list("originals",{limit:1000});
  if(listed.error||listed.data.length!==Object.keys(ALLOWED).length||listed.data.some(x=>ALLOWED[x.name]!==Number(x.metadata?.size)))return response({error:"Original inventory incomplete"},409);
  const marked=await client.storage.from(BUCKET).upload("_migration/closed.json",JSON.stringify({closed_at:new Date().toISOString(),count:listed.data.length}),{contentType:"application/json",upsert:false});
  if(marked.error)return response({error:"Could not close migration"},502);
  return response({closed:true,count:listed.data.length});
 }
 if(url.pathname.endsWith("/setup")){
  const existing=await client.storage.getBucket(BUCKET);
  if(existing.data){if(existing.data.public)return response({error:"Bucket is not private"},409);return response({bucket:BUCKET,private:true});}
  const made=await client.storage.createBucket(BUCKET,{public:false,fileSizeLimit:35*1024*1024});
  if(made.error)return response({error:"Bucket creation failed",detail:made.error.message},502);
  return response({bucket:BUCKET,private:true});
 }
 const sha=url.searchParams.get("sha")||"";
 if(!Object.prototype.hasOwnProperty.call(ALLOWED,sha))return response({error:"Photo outside approved migration manifest"},403);
 const declared=Number(req.headers.get("content-length"));
 if(declared!==ALLOWED[sha])return response({error:"Size mismatch"},400);
 const bytes=await req.arrayBuffer();
 if(bytes.byteLength!==ALLOWED[sha]||await digest(bytes)!==sha)return response({error:"Content hash mismatch"},400);
 const path="originals/"+sha;
 const uploaded=await client.storage.from(BUCKET).upload(path,bytes,{contentType:"application/octet-stream",upsert:false});
 if(uploaded.error){
  const old=await client.storage.from(BUCKET).download(path);
  if(old.error||!old.data||await digest(await old.data.arrayBuffer())!==sha)return response({error:"Upload failed",detail:uploaded.error.message},502);
 }
 const signed=await client.storage.from(BUCKET).createSignedUrl(path,120);
 if(signed.error)return response({error:"Verification URL failed"},502);
 return response({sha256:sha,bytes:bytes.byteLength,bucket:BUCKET,path,verification_url:signed.data.signedUrl});
});
