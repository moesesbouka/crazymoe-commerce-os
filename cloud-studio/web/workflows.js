"use strict";
// Shared by individual approval and explicit owner-selected bulk operations.
globalThis.studioWorkflows = {
  async verifyPhotos(response, fetchFile = fetch) {
    const snapshot=response?.snapshot;
    if(!snapshot || !Array.isArray(snapshot.images) || !snapshot.images.length || snapshot.images.length>10 || response.urls?.length!==snapshot.images.length)
      throw Error("The saved listing or photo set is incomplete.");
    const files=[];
    for(const [position,file] of snapshot.images.entries()) {
      const fetched=await fetchFile(response.urls[position],{cache:"no-store"});
      if(!fetched.ok)throw Error("Listing photo "+(position+1)+" is unavailable.");
      const bytes=new Uint8Array(await fetched.arrayBuffer());
      const sha=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
      if(bytes.byteLength!==file.bytes || sha!==file.sha)throw Error("Listing photo "+(position+1)+" failed integrity verification.");
      if(bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255)throw Error("Listing photo "+(position+1)+" is not a JPEG.");
      files.push(bytes);
    }
    return files;
  },
  suggestedPrice(item) {
    const c=item.research?.catalog_match;
    const price=Number(c?.retailer_price_reference);
    const url=item.fields?.source_url || item.generated_candidate?.source_url;
    if(!Number.isFinite(price)||price<=0||!/^\d{4}-\d{2}-\d{2}/.test(c?.retailer_price_checked||"")||!/^https:\/\//.test(url||""))return null;
    return {price:Math.round(price*50)/100,retail:price,checked:c.retailer_price_checked,url};
  },
  async run(items, operation, progress=()=>{}) {
    const results=[];
    for(const item of items){
      progress(results.length+1,items.length,item);
      try{results.push({id:item.id,ok:true,result:await operation(item)});}
      catch(error){results.push({id:item.id,ok:false,error:error.message||String(error)});}
    }
    return results;
  },
  // Standard uncompressed ZIP; no external CDN or dependency sees private photos.
  zip(entries) {
    const encoder=new TextEncoder(),parts=[],directory=[];let offset=0;
    const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
    for(const entry of entries){
      const name=encoder.encode(entry.name),bytes=typeof entry.data==="string"?encoder.encode(entry.data):entry.data;
      if(name.length>65535||bytes.length>0xffffffff)throw Error("Export file too large.");
      const checksum=crc(bytes),header=new Uint8Array(30),h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,checksum,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);
      const central=new Uint8Array(46),d=new DataView(central.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,checksum,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);
      parts.push(header,name,bytes);directory.push(central,name);offset+=header.length+name.length+bytes.length;
    }
    if(entries.length>65535||offset>0xffffffff)throw Error("Export is too large; select fewer products.");
    const end=new Uint8Array(22),v=new DataView(end.buffer),size=directory.reduce((n,a)=>n+a.length,0);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
    return new Blob([...parts,...directory,end],{type:"application/zip"});
  }
};
