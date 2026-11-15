import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
const PROJECT_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const EXPECTED = '4c1ec8e4e80af664b1e23c66107701bdd3bb104218b964a15b040299390189e2';
const KNOWN_MODELS = ['claude', 'gemini', 'grok', 'gpt'];
const CORS = {
  'Access-Control-Allow-Origin': 'https://moe-ai-council.lovable.app',
  'Access-Control-Allow-Headers': 'content-type,x-council-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Cache-Control': 'no-store',
  'Vary': 'Origin'
};
function response(body: Record<string,unknown>, status=200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}
function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
async function digest(value: string) {
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, {status:204,headers:CORS});
  if (req.headers.get('Origin') && req.headers.get('Origin') !== 'https://moe-ai-council.lovable.app') return response({error:'Origin not allowed'},403);
  const key=req.headers.get('x-council-key')??'';
  if (!key || await digest(key)!==EXPECTED) return response({error:'Access key rejected. Open your original personal activation link.'},401);
  if (!PROJECT_URL || !SERVICE_KEY) return response({error:'Server database credentials are unavailable.'},503);
  const db=createClient(PROJECT_URL,SERVICE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(req.url);
  if(req.method === 'GET') {
    const id=url.searchParams.get('jobId')??'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      return response({error:'Invalid consultation ID.'},400);
    const {data,error}=await db.from('council_jobs').select('id,state,results,errors,message,created_at,updated_at,expires_at').eq('id',id).maybeSingle();
    if(error)return response({error:'Unable to load consultation.'},503);
    if(!data)return response({error:'Consultation not found.'},404);
    if(new Date(data.expires_at).getTime()<Date.now())return response({error:'Consultation has expired.'},410);
    return response({jobId:data.id,state:data.state,results:data.results??{},errors:data.errors??{},message:data.message??null,updated_at:data.updated_at});
  }
  if(req.method !== 'POST') return response({error:'Method not allowed.'},405);
  let payload: any;
  try{payload=await req.json()}catch{return response({error:'Invalid request JSON.'},400)}
  const prompt=typeof payload.firePrompt==='string'?payload.firePrompt.trim():'';
  const context=typeof payload.context==='string'?payload.context:'';
  const models=Array.isArray(payload.models)?Array.from(new Set(payload.models)):[];
  if(!prompt || prompt.length>30000 || context.length>30000 || !models.length || models.length>4 || !models.every((m:unknown)=>KNOWN_MODELS.includes(String(m))))
    return response({error:'Choose 1–4 models and enter a question of up to 30,000 characters.'},400);
  const {data,error}=await db.from('council_jobs').insert({state:'queued'}).select('id').single();
  if(error || !data)return response({error:'Could not start consultation.'},503);
  const jobId=data.id as string;
  const run=async()=>{
    try {
      await db.from('council_jobs').update({state:'running',updated_at:new Date().toISOString()}).eq('id',jobId);
      const res=await fetch(PROJECT_URL+'/functions/v1/crunch', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-council-key':key},
        body:JSON.stringify({sessionId:crypto.randomUUID(),round:1,isNew:true,firePrompt:prompt,context,models}),
        signal:AbortSignal.timeout(125000)
      });
      const obj=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(typeof obj.error==='string'?obj.error:'Council backend returned HTTP '+res.status);
      const results=obj.results&&typeof obj.results==='object'?obj.results:{};
      const errors=obj.errors&&typeof obj.errors==='object'?obj.errors:{};
      const completed=Object.keys(results).filter(m=>typeof results[m]==='string'&&results[m]&&!results[m].startsWith('Error:')).length;
      const state=completed===models.length?'completed':completed>0?'partial':'failed';
      const {error:saveError}=await db.from('council_jobs').update({state,results,errors,updated_at:new Date().toISOString(),message:state==='failed'?'All model requests failed. Check individual errors.':null}).eq('id',jobId);
      if(saveError)console.error('Council job save failed:',saveError.code);
    } catch(e){
      const reason=errorMessage(e).slice(0,300);
      await db.from('council_jobs').update({state:'failed',message:reason,updated_at:new Date().toISOString()}).eq('id',jobId);
      console.error('Council job failed:',reason.slice(0,120));
    }
  };
  EdgeRuntime.waitUntil(run());
  return response({jobId,state:'queued'},202);
});
