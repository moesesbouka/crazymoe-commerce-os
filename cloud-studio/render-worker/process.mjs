// Cloud-only orchestrator. Storage and renderer are injected for regression tests.
export async function runRender(job, context, io) {
  if (context.photos.length !== job.snapshot.selection.length || context.photos.length < 1 || context.photos.length > 10)
    throw Error('Incomplete source set');
  for (let index=0; index<context.photos.length; index++) {
    const photo=context.photos[index], selected=job.snapshot.selection[index];
    if (photo.sha256!==selected.sha || selected.kind!=='real' || photo.bucket!=='studio-originals')
      throw Error('Source order mismatch');
  }
  async function processPhoto(index) {
    const photo=context.photos[index], selected=job.snapshot.selection[index];
    const signed=await io.sign(photo);
    const rendered=await io.render({url:signed,sha256:photo.sha256,bytes:photo.bytes,
      style:selected.style_mode??'natural',pop:selected.pop??false});
    if (!(rendered instanceof Uint8Array) || rendered.length<4 || rendered.length>4000000 ||
        rendered[0]!==255 || rendered[1]!==216 || rendered.at(-2)!==255 || rendered.at(-1)!==217)
      throw Error('Invalid JPEG transport');
    // The authenticated Python renderer fully decodes/verifies the JPEG geometry.
    // Independently verify the bytes stored in cloud before registering receipts.
    const sha=await io.hash(rendered), path='exports/'+sha;
    await io.upload(path,rendered); // Insert only. Existing objects are never overwritten.
    const downloaded=await io.download(path);
    if(downloaded.length!==rendered.length || await io.hash(downloaded)!==sha)
      throw Error('Stored JPEG verification failed');
    return {sha,bytes:rendered.length,width:1600,height:1600,
      source_sha:photo.sha256,recipe:job.snapshot.recipe};
  }
  const receipts=[];
  // CPU-heavy decoding stays on Vercel. Four bounded transports keep Edge memory
  // below its limit and avoid making ten image renders run sequentially.
  for(let offset=0; offset<context.photos.length; offset+=4){
    const chunk=await Promise.allSettled(context.photos.slice(offset,offset+4).map((_,i)=>processPhoto(offset+i)));
    const failed=chunk.find(x=>x.status==='rejected');
    if(failed)throw failed.reason;
    receipts.push(...chunk.map(x=>x.value));
  }
  return receipts;
}
