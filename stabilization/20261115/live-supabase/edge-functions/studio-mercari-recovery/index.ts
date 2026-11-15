import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
const origins=new Set(['https://studio.crazymoe.com','https://crazymoe-marketplace-studio.vercel.app']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin'),headers:Record<string,string>={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'Origin not permitted'},403);
 if(origin){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
 if(req.method==='OPTIONS'){headers['Access-Control-Allow-Headers']='authorization, apikey, content-type';headers['Access-Control-Allow-Methods']='POST, OPTIONS';return new Response(null,{status:204,headers});}
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const authorization=req.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))return reply({error:'Sign in required'},401);
 const url=Deno.env.get('SUPABASE_URL')!,client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
 const identity=await client.auth.getUser(authorization.slice(7));if(identity.error||!identity.data.user)return reply({error:'Session invalid'},401);
 try{
  const raw=await req.text();if(raw.length>40000)return reply({error:'Recovery details too large'},413);
  const body=JSON.parse(raw),{queue_id,revision,batch,files,description,condition}=body;
  if(typeof queue_id!=='string'||!Number.isSafeInteger(revision)||!/^[a-f0-9-]{36}$/.test(batch)||!Array.isArray(files)||files.length>12||typeof description!=='string'||description.length>20000)return reply({error:'Invalid recovery details'},400);
  const state=await client.rpc('studio_mercari_state');if(state.error)return reply({error:'Studio access denied'},403);
  const queue=state.data.queue.find((q:{id:string})=>q.id===queue_id);
  if(!queue||queue.source_kind!=='imported'||!['needs_details','ready'].includes(queue.state)||!queue.available)return reply({error:'Choose an available imported queue item'},403);
  if(queue.revision!==revision)return reply({error:'This queue item changed. Refresh before recovering.'},409);
  const user=identity.data.user.id,admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}}),checked=[];let total=0;
  for(const file of files){
   if(!/^[a-f0-9]{64}$/.test(file.sha)||typeof file.name!=='string'||file.name.length>200||!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>16000000)return reply({error:'Invalid product photo'},400);
   const object=await admin.storage.from('studio-originals').download('incoming/'+user+'/'+batch+'/'+file.sha);
   if(object.error||!object.data||object.data.size!==file.bytes)return reply({error:'A recovery photo is missing or incomplete'},409);
   const bytes=new Uint8Array(await object.data.arrayBuffer());total+=bytes.length;if(total>100*1024*1024)return reply({error:'Recovery photo batch too large'},413);
   const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   if(sha!==file.sha)return reply({error:'Photo verification failed'},409);
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes[0]===137&&String.fromCharCode(...bytes.slice(1,4))==='PNG',webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
   if(!jpeg&&!png&&!webp)return reply({error:'Use JPEG, PNG or WebP product photos'},415);
   if(!checked.some(x=>x.sha===sha))checked.push({sha,name:file.name,bytes:bytes.length});
  }
  const saved=await admin.rpc('studio_mercari_finish_recovery',{p_user:user,p_id:queue_id,p_revision:revision,p_batch:batch,p_files:checked,p_description:description,p_condition:condition||''});
  if(saved.error)return reply({error:saved.error.code==='40001'?'This queue item changed. Refresh before recovering.':'Recovery could not be saved'},saved.error.code==='40001'?409:400);
  return reply(saved.data);
 }catch(error){return reply({error:error instanceof SyntaxError?'Invalid recovery JSON':'Recovery request failed'},400);}
});
