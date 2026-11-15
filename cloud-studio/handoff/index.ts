import {createClient} from "npm:@supabase/supabase-js@2.119.0";
Deno.serve(async req=>{
  if (req.method!=="POST") return new Response(null,{status:405});
  const secret=req.headers.get("Authorization")?.replace(/^Bearer /,"");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return new Response(null,{status:401});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const claim=await admin.rpc("studio_claim_handoff",{p_secret:secret});
  if(claim.error || !claim.data) return new Response(null,{status:claim.error?503:410});
  const item=claim.data;
  const urls=await admin.storage.from("studio-originals").createSignedUrls(item.images.map((p:{sha:string})=>"exports/"+p.sha),180);
  if(urls.error || urls.data.some(x=>!x.signedUrl))return new Response(null,{status:503});
  return Response.json({item,urls:urls.data.map(x=>x.signedUrl)},{headers:{"Cache-Control":"no-store"}});
});
