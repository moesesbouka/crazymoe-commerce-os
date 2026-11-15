'use strict';
globalThis.MercariCopy = (() => {
 const shipping = () => ({payer:'buyer',weight_oz:'',length_in:'',width_in:'',height_in:''});
 const photoNotice='You will receive the actual product shown in the photos, with exactly the items and accessories pictured.';
 function plainText(value) {
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',times:' x ',deg:' degrees ',micro:'u',plusmn:'+/-',le:'<=',ge:'>=',ndash:'-',mdash:'-',hellip:'...',copy:'',reg:'',trade:'',bull:'- ',lsquo:"'",rsquo:"'",ldquo:'"',rdquo:'"'};
  return String(value||'').replace(/\\r\\n|\\n/g,'\n').replace(/\r\n?/g,'\n')
   .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi,(entity,key)=>{
    if(key[0]!=='#')return entities[key.toLowerCase()]??entity;
    const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
   })
   .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<li\b[^>]*>/gi,'- ').replace(/<\/?[a-z][^>]*>/gi,'')
   .replace(/[\u2018-\u201b\u2032]/g,"'").replace(/[\u201c-\u201f\u2033]/g,'"').replace(/[\u2010-\u2015\u2212]/g,'-')
   .replace(/[\u2022\u2023\u2043\u25aa\u25ab\u25cf\u25e6]/g,'- ').replace(/\u2026/g,'...')
   .replace(/\u00d7/g,' x ').replace(/\u00f7/g,' / ').replace(/\u00b1/g,'+/-').replace(/\u2264/g,'<=').replace(/\u2265/g,'>=')
   .replace(/\u2192/g,' -> ').replace(/\u2190/g,' <- ').replace(/\u2194/g,' <-> ')
   .replace(/\u00b0/g,' degrees ').replace(/[\u03a9\u2126]/g,' ohms').replace(/[\u00b5\u03bc]/g,'u').replace(/[\u00a9\u00ae\u2122]/g,'')
   .replace(/([0-9])([\u00bc-\u00be\u2150-\u215e])/g,'$1 $2').normalize('NFKD').replace(/\u2044/g,'/').replace(/[\u0300-\u036f]/g,'')
   .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/[\t\u00a0]/g,' ').replace(/[^\x20-\x7e\n]+/g,' ').split('\n').map(line=>line.replace(/ +/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
 }
 function shorten(body,limit,source) {
  const concise=body.replace(/\bapproximately\b/gi,'approx.').replace(/\binches\b/gi,'in').replace(/\bpounds\b/gi,'lb')
   .replace(/\b(?:please note that|it is important to note that)\s*/gi,'').replace(/\bcomes complete with\b/gi,'Includes');
  if(concise.length<=limit)return concise;
  const seen=new Set(),facts=concise.replace(/\b(?:(?:total|net|packed|shipping|item|power|input|output|no|what's|what is)\s+)?(?:not included|condition|included|model|compatibility|dimensions|weight|power|input|output|warning|important)\s*:/gi,'\n$&')
   .replace(/\b(?:approx|in|ft|lb|oz|no|vs|e\.g|i\.e)\./gi,t=>t.replace(/\./g,'\u0001'))
   .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])|\s+-\s+(?=[A-Z0-9])/).map(t=>t.replace(/\u0001/g,'.').replace(/^\s*-\s*/,'').trim())
   .flatMap(t=>{const list=t.length>limit&&t.match(/^((?:not included|does not include|included|includes|missing|condition|not compatible with|compatible with)\s*:?\s+)(.+)$/i);return list&&list[2].includes(',')?list[2].split(/,\s*/).map(part=>list[1]+part.replace(/^(?:and|or)\s+/i,'')):[t];})
   .filter(t=>t&&!/^(?:product overview|key features(?: & engineering)?|features|technical specifications|specifications|product details|item condition & inclusions|verified authenticity)\s*:?$/i.test(t))
   .filter(t=>{const key=t.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(seen.has(key))return false;seen.add(key);return true;})
   .map((text,index)=>{
    let priority=index===0?500:100;
    if(/\b(?:missing|not included|does not|doesn't|not working|not tested|not guaranteed|unverified|may not|intermittent|untested|without|no (?:remote|power|cable|battery|charger|adapter|accessories|box|warranty|cartridge|stylus|dustcover|manual)|scratch\w*|dent\w*|crack\w*|chip\w*|defect\w*|damage\w*|broken|fault\w*|for parts|as.is|repair\w*|warning|caution)\b/i.test(text))priority=1200;
    else if(/\b(?:includes?|included|comes with|equipped with|fitted with|contents|accessories|supplied)\b/i.test(text))priority=1100;
    else if(/\b(?:condition|open.box|store display|display unit|demo unit|floor.model|new|sealed|used|tested|functional|refurbished)\b/i.test(text))priority=1000;
    else if(/\b(?:requires?|required|must|only|compatible|compatibility|fits?|fitment|not compatible)\b/i.test(text))priority=900;
    else if(/\b(?:model|mpn|part number|sku)\b/i.test(text)||(source.fields?.model&&text.toLowerCase().includes(String(source.fields.model).toLowerCase())))priority=800;
    else if(/\b(?:HDMI|USB|PoE|RJ45|Bluetooth|Wi.Fi|DIN|inputs?|outputs?|connections?|ports?|capacity|resolution|balanced)\b/i.test(text))priority=700;
    else if(/\d|\b(?:HDMI|USB|PoE|RJ45|Bluetooth|Wi.Fi|capacity|resolution|dimensions|weight|size|power)\b/i.test(text))priority=600;
    if(priority<=600&&/\bserial (?:number|no)\b/i.test(text))priority=150;
    if(priority<600&&/\b(?:perfect|enjoy|elevate|unparalleled|exceptional|stunning|premium|seamless|experience)\b/i.test(text))priority-=200;
    return {text,index,priority};
   }).sort((a,b)=>b.priority-a.priority||(a.priority>=800?a.text.length-b.text.length:0)||a.index-b.index);
  const selected=[];let remaining=limit;
  for(const fact of facts)if(fact.text.length<=remaining){selected.push(fact);remaining-=fact.text.length+1;}
  // A long condition/defect disclosure takes precedence over shorter marketing copy.
  const oversized=facts.find(f=>f.priority>=800&&f.text.length>limit&&selected.every(s=>s.priority<f.priority));
  if(!selected.length||oversized){
   const text=oversized?.text||facts[0]?.text||concise,marker=text.search(/\b(?:missing|not included|does not|not working|untested|scratch\w*|dent\w*|crack\w*|defect\w*|broken|for parts|as.is)\b/i);
   let start=marker>limit/2?Math.max(0,marker-Math.floor(limit/3)):0;
   if(start>0){const boundary=text.indexOf(' ',start);if(boundary>=0)start=boundary+1;}
   const available=limit-(start?7:3);let end=Math.min(text.length,start+available);
   if(end<text.length&&text[end]!==' '){const space=text.lastIndexOf(' ',end);if(space>start+available/2)end=space;}
   return (start?'... ':'')+text.slice(start,end).trim()+(end<text.length?'...':'');
  }
  return selected.map(f=>f.text).join('\n');
 }
 function description(value,source={}) {
  let body=plainText(value);
  while(body.startsWith(photoNotice))body=body.slice(photoNotice.length).trimStart();
  const limit=1000-photoNotice.length-2;if(body.length>limit)body=shorten(body,limit,source);
  return photoNotice+(body?'\n\n'+body:'');
 }
 function price(value) {
  const match=String(value??'').trim().match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
  if(!match)return '';
  const cents=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
  return cents>0?(Math.round(cents*110/100)/100).toFixed(2):'';
 }
 function defaults(draft,source) {
  const base=source.fields?.price??source.suggestions?.price;
  return {...draft,description:description(draft.description,source),price:draft.price??price(base),condition:condition(draft.condition||source.fields?.condition),photos_confirmed:true};
 }
 function clean(value) {
  // Remove whole promotional sentences while preserving product facts and defects.
  const removed=[];
  const publicBlocks=String(value||'').replace(/\\r\\n|\\n/g,'\n').replace(/\r/g,'').split(/\n\s*\n/).filter(block=>{
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
   'used':'Good','used - good':'Good','good':'Good','used - fair':'Fair','fair':'Fair','poor':'Poor','for parts or not working':'Poor'})[String(value||'').toLowerCase().trim()]||(String(value||'').trim()?'':'New');
 }
 function brand(source) {
  const supplied=source.brand||source.fields?.brand;
  if(supplied)return supplied;
  const title=String(source.fields?.title||source.suggestions?.title||'');
  // Exact named brands from the source title, without inventing specifications.
  const brands=['Bowers & Wilkins','MartinLogan','Harman Kardon','Definitive Technology','Audio-Technica','Walker Edison','Hampton Bay','Sonance','Rotel','Marantz','Denon','McIntosh','Arcam','Klipsch','Sonos','Bose','Yamaha','Pioneer','Onkyo','Integra','Samsung','Insignia','Hisense','Toshiba','Panasonic','Sony','Sennheiser','JBL','KEF','SVS','TCL','LG','IPORT','Tineco','Dyson','Ninja','Shark','Segway','Lectric','SmartBurner','Pro-Ject','Breville','Nespresso','Keurig','Cuisinart','KitchenAid','Hamilton Beach','Black & Decker','BLACK+DECKER','DeWalt','Milwaukee','Ryobi','Makita','Craftsman','Husky','Ridgid','Bosch','Dremel','Kobalt','Metabo','WORX','GE Profile','General Electric','Frigidaire','Whirlpool','Maytag','Kenmore','Electrolux','Midea','Gree','NewAir','Danby','Vornado','Honeywell','Lasko','Dreo','Bissell','Hoover','iRobot','Eureka','Roborock','Eufy','Ecovacs','Neakasa','Petlibro','Birdfy','Furbo','PetSafe','Nexgrill','Weber','Char-Broil','Blackstone','Traeger','Pit Boss','Cosmo','Avondale','Glacier Bay','Delta','Moen','Kohler','American Standard','Pfister','Allen + Roth','StyleWell','Home Decorators Collection','Hampton Bay','HomePop','Sauder','Ashley','IKEA','Serta','Sealy','Lucid','GhostBed','Zinus','Madison Park','Mohawk','LifeProof','Pergo','Schwinn','Razor','Gotrax','Hiboy','NIU','Jetson','Aventon','Rad Power Bikes','ATARI','Arcade1Up','iiRcade','Nintendo','PlayStation','Xbox','Microsoft','Apple','Google','Amazon','Dell','HP','Lenovo','Acer','ASUS','MSI','NZXT','Corsair','Logitech','Razer','Alienware','AOC','ViewSonic','BenQ','Dough','Kodak','Canon','Nikon','Fujifilm','GoPro','DJI','Ring','Blink','Arlo','Wyze','TP-Link','Netgear','Linksys','Ubiquiti','Anker','Belkin','Baseus','Atlona','URC','Universal Remote Control','Sonance','MEE Audio','Infant Optics','Graco','Chicco','Fisher-Price','Little Tikes','LEGO','Melissa & Doug','HITORHIKE','ATEPA','Mr. Chain','Yuking','TurnWedge'];
  return brands.find(name=>new RegExp('(?:^|[^a-z0-9])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(title))||'';
 }
 function prepare(source,preset) {
  const f=source.fields||{},suggestions=source.suggestions||{};
  const value=k=>Object.hasOwn(f,k)?String(f[k]??''):String(suggestions[k]??'');
  const text=clean(value('description'));
  return defaults({title:value('title').trim().slice(0,80),description:text.text,
   price:price(value('price'))||value('price'),condition:condition(value('condition')),brand:brand(source),category:/[a-z]/i.test(f.category||'')?String(f.category):'',
   shipping:structuredClone(preset||shipping()),photos:(source.photos||[]).slice(0,12),photos_confirmed:true},source);
 }
 function listingText(draft) {
  const s=draft.shipping;
  return `TITLE\n${draft.title}\n\nPRICE\n$${draft.price}\n\nCONDITION\n${draft.condition}\n\nBRAND\n${draft.brand}\n\nCATEGORY\n${draft.category}\n\nDESCRIPTION\n${description(draft.description)}\n\nPACKED SHIPPING\n${s.weight_oz} oz; ${s.length_in} x ${s.width_in} x ${s.height_in} in; ${s.payer} pays\n`;
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
 return {shipping,clean,condition,brand,plainText,description,price,defaults,photoNotice,prepare,listingText,itemUrl,format};
})();
