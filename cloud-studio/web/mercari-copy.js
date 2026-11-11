'use strict';
globalThis.MercariCopy = (() => {
 const shipping = () => ({payer:'buyer',weight_oz:'',length_in:'',width_in:'',height_in:''});
 function clean(value) {
  // Remove whole promotional sentences while preserving product facts and defects.
  const removed=[];
  const publicBlocks=String(value||'').replace(/\r/g,'').split(/\n\s*\n/).filter(block=>{
   if(/^\s*(?:internal|staff|warehouse)\s+notes?\b/i.test(block)){removed.push(block);return false;}return true;
  });
  const paragraphs=publicBlocks.join('\n\n').split(/\n+/).map(line=>{
   if(/^\s*(?:sku|inventory\s*(?:id|code)|internal\s+notes?)\s*[:#-]/i.test(line)){removed.push(line);return '';}
   return line.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(sentence=>{
    const promo=/cash\s*app|cashapp|venmo|paypal|facebook|messenger|instagram|crazy\s*moe|buffalo\s*deal\s*depot|scan.{0,30}qr|qr\s*code|https?:\/\/|www\.|\b(?:pickup|pick.up|warehouse|appointment)\b|message\s+(?:me|us|with|for)|\b(?:716[- .)]|\(?716\))/i.test(sentence);
    if(promo)removed.push(sentence);return !promo;
   }).join(' ');
  }).filter(Boolean);
  return {text:paragraphs.join('\n\n').trim(),removed};
 }
 function condition(value) {
  return ({'new':'New','new with tags':'New','new without tags':'Like new','used - like new':'Like new','like new':'Like new',
   'used - good':'Good','good':'Good','used - fair':'Fair','fair':'Fair','poor':'Poor'})[String(value||'').toLowerCase().trim()]||'';
 }
 function brand(source) {
  const supplied=source.brand||source.fields?.brand;
  if(supplied)return supplied;
  const title=String(source.fields?.title||source.suggestions?.title||'');
  // Exact named brands from the source title, without inventing specifications.
  const brands=['Bowers & Wilkins','MartinLogan','Harman Kardon','Definitive Technology','Audio-Technica','Walker Edison','Hampton Bay','Sonance','Rotel','Marantz','Denon','McIntosh','Arcam','Klipsch','Sonos','Bose','Yamaha','Pioneer','Onkyo','Integra','Samsung','Insignia','Hisense','Toshiba','Panasonic','Sony','Sennheiser','JBL','KEF','SVS','TCL','LG','IPORT','Tineco','Dyson','Ninja','Shark','Segway','Lectric'];
  return brands.find(name=>new RegExp('(?:^|[^a-z0-9])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(title))||'';
 }
 function prepare(source,preset) {
  const f=source.fields||{},suggestions=source.suggestions||{};
  const value=k=>Object.hasOwn(f,k)?String(f[k]??''):String(suggestions[k]??'');
  const text=clean(value('description'));
  return {title:value('title').trim().slice(0,80),description:text.text,
   price:value('price'),condition:condition(value('condition')),brand:brand(source),category:/[a-z]/i.test(f.category||'')?String(f.category):'',
   shipping:structuredClone(preset||shipping()),photos:(source.photos||[]).slice(0,12),photos_confirmed:source.source_kind==='studio'};
 }
 function listingText(draft) {
  const s=draft.shipping;
  return `TITLE\n${draft.title}\n\nPRICE\n$${draft.price}\n\nCONDITION\n${draft.condition}\n\nBRAND\n${draft.brand}\n\nCATEGORY\n${draft.category}\n\nDESCRIPTION\n${draft.description}\n\nPACKED SHIPPING\n${s.weight_oz} oz; ${s.length_in} × ${s.width_in} × ${s.height_in} in; ${s.payer} pays\n`;
 }
 function itemUrl(value) {
  try {const u=new URL(value);return u.protocol==='https:'&&['mercari.com','www.mercari.com'].includes(u.hostname)&&!u.username&&!u.password&&/^\/us\/item\/m\d+\/?$/.test(u.pathname)?'https://www.mercari.com'+u.pathname.replace(/\/?$/,'/'):null;}catch{return null;}
 }
 function format(photo,bytes) {
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'png';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'webp';
  throw Error('A product photo is not a supported image.');
 }
 return {shipping,clean,condition,prepare,listingText,itemUrl,format};
})();
