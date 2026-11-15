import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405,headers});
 const token=(req.headers.get("authorization")||"").replace(/^Bearer /,"");
 if(!/^[a-f0-9]{64}$/.test(token))return Response.json({error:"Invalid transfer"},{status:401,headers});
 try{
  const raw=await req.text();if(raw.length>4096)throw Error("Request too large");
  const body=JSON.parse(raw||"{}");
  if(!["read","filled","error"].includes(body.action))throw Error("Invalid action");
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const result=await admin.rpc("studio_posting_transfer",{p_token:token,p_action:body.action,p_evidence:body.evidence||{}});
  if(result.error)return Response.json({error:"Transfer expired, changed, or unavailable. Refresh the queue."},{status:409,headers});
  return Response.json(result.data,{headers});
 }catch{return Response.json({error:"Invalid transfer request"},{status:400,headers});}
});
