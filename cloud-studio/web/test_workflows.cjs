const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
globalThis.crypto=require('node:crypto').webcrypto;require('./workflows.js');const flow=globalThis.studioWorkflows;
test('exact JPEG bytes and order are verified, corruption is rejected',async()=>{
 const buffers=[Uint8Array.from([255,216,255,1]),Uint8Array.from([255,216,255,2])];
 const images=await Promise.all(buffers.map(async bytes=>({bytes:bytes.length,sha:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')})));
 const payload={snapshot:{images},urls:['0','1']};const fetchFile=async url=>({ok:true,arrayBuffer:async()=>buffers[Number(url)].buffer});
 assert.deepEqual(await flow.verifyPhotos(payload,fetchFile),buffers);
 await assert.rejects(flow.verifyPhotos({...payload,urls:['1','0']},fetchFile),/integrity/);
 await assert.rejects(flow.verifyPhotos({...payload,urls:['0']},fetchFile),/incomplete/);
});
test('bulk actions isolate failures and continue with exact item IDs',async()=>{
 const result=await flow.run([{id:'one'},{id:'two'}],async item=>{if(item.id==='one')throw Error('stale revision');return 3;});
 assert.deepEqual(result,[{id:'one',ok:false,error:'stale revision'},{id:'two',ok:true,result:3}]);
});
test('half-retail suggestion requires recorded price, date and source',()=>{
 assert.equal(flow.suggestedPrice({generated_candidate:{price:'100'}}),null);
 const item={research:{catalog_match:{retailer_price_reference:'199.99',retailer_price_checked:'2026-11-01'}},fields:{source_url:'https://example.com/item'}};
 assert.equal(flow.suggestedPrice(item).price,100);
});
test('standard ZIP preserves ordered private JPEGs and listing metadata',async()=>{
 const zip=flow.zip([{name:'item/listing.json',data:'{"price":"45"}'},{name:'item/01.jpg',data:Uint8Array.from([255,216,255])}]);
 const bytes=Buffer.from(await zip.arrayBuffer());assert.equal(bytes.readUInt32LE(),0x04034b50);
 const result=require('node:child_process').spawnSync('python',['-c','import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==["item/listing.json","item/01.jpg"]; assert z.testzip() is None; assert z.read("item/01.jpg")==bytes([255,216,255])'],{input:bytes});
 assert.equal(result.status,0,result.stderr.toString());
});
