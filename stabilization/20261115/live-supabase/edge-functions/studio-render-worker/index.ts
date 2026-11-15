import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {runRender} from './process.mjs';

Deno.serve(async req=>{
  const headers={'Cache-Control':'private, no-store'};
  if(req.method!=='POST')return new Response(null,{status:405,headers});
  const token=req.headers.get('x-studio-worker')||'';
  if(token.length!==72)return new Response(null,{status:401,headers});
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {auth:{persistSession:false,autoRefreshToken:false}});
  const claimed=await admin.rpc('studio_render_claim',{p_token:token});
  if(claimed.error)return new Response(null,{status:claimed.error.code==='42501'?403:503,headers});
  const job=claimed.data;
  if(!job)return Response.json({claimed:false},{headers});
  let receipts=null,failure=null;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),110000);
  try {
    const result=await admin.rpc('studio_render_context',{p_job:job.id,p_attempt:job.attempt,p_token:token});
    if(result.error||!result.data)throw Error('Render configuration unavailable');
    const context=result.data;
    if(context.endpoint!=='https://crazymoe-marketplace-studio.vercel.app/api/process_render' || context.secret.length<64)
      throw Error('Render configuration invalid');
    const bucket=admin.storage.from('studio-originals');
    receipts=await runRender(job,context,{
      sign:async(photo)=>{
        const signed=await bucket.createSignedUrl(photo.object_path,120);
        if(signed.error||!signed.data)throw Error('Original unavailable');
        return signed.data.signedUrl;
      },
      render:async(body)=>{
        const response=await fetch(context.endpoint,{method:'POST',redirect:'error',signal:controller.signal,
          headers:{'Authorization':'Bearer '+context.secret,'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!response.ok||response.headers.get('content-type')!=='image/jpeg')throw Error('Renderer unavailable');
        const reader=response.body!.getReader(),chunks=[];let length=0;
        while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;
          if(length>4000000){await reader.cancel();throw Error('Rendered output too large');}chunks.push(value);}
        const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return bytes;
      },
      hash:async(bytes)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''),
      upload:async(path,bytes)=>{
        const uploaded=await bucket.upload(path,bytes,{contentType:'image/jpeg',upsert:false});
        if(uploaded.error&&!['409','400'].includes(String(uploaded.error.statusCode)))throw Error('Export upload failed');
        // Duplicate-object errors are allowed only because download/hash follows.
      },
      download:async(path)=>{
        const value=await bucket.download(path);if(value.error||!value.data)throw Error('Export unavailable');
        return new Uint8Array(await value.data.arrayBuffer());
      }
    });
  } catch(error) {failure=error instanceof Error&&error.name==='AbortError'?'Render time budget exceeded':'Cloud render verification failed';}
  finally{clearTimeout(timer);}
  const finished=await admin.rpc('studio_render_finish',{p_job:job.id,p_attempt:job.attempt,p_images:receipts,p_failure:failure});
  return Response.json({claimed:true,recorded:!finished.error,completed:!failure&&!finished.error&&finished.data===true},
    {status:finished.error?503:200,headers});
});
