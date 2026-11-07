(function(root){
 'use strict';
 const photoRoot='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/';
 const clean=s=>String(s??'').replace(/\r\n/g,'\n').trim();
 function issues(item){
  const list=[];
  if(!clean(item.title))list.push('Title missing');
  if(!clean(item.description))list.push('Description missing');
  if(!clean(item.condition))list.push('Condition missing');
  if(item.price===null||item.price===undefined||!Number.isFinite(Number(item.price))||Number(item.price)<0)list.push('Price missing');
  if(!Array.isArray(item.images)||!item.images.some(x=>typeof x==='string'&&x.startsWith(photoRoot)))list.push('Archived public photos missing');
  if(clean(item.title).length>150)list.push('Title needs shortening');
  if(clean(item.description).length>19500)list.push('Description needs shortening');
  return list;
 }
 // A conservative copy refresh: every original paragraph and qualifier survives.
 // No model, condition, compatibility, price, or warranty claims are invented.
 function refreshCopy(item,style='details'){
  let title=clean(item.title);
  const parts=title.split(/\s+[–—|]\s+|\s+-\s+/).map(clean).filter(Boolean);
  if(parts.length>1)title=[parts.slice(1).join(' · '),parts[0]].join(' — ');
  const source=clean(item.description);
  const blocks=source.split(/\n\s*\n/).map(clean).filter(Boolean);
  const intro=style==='details'?'Details for this item:':'About this item:';
  // Reorder only complete paragraphs, keeping the seller's leading condition note first.
  const rest=blocks.length>2?[blocks[0],...blocks.slice(2),blocks[1]]:blocks;
  const description=[clean(item.title),intro,...rest].filter(Boolean).join('\n\n');
  return {title,description,price:item.price,condition:item.condition,category:item.category,
   images:[...new Set((item.images||[]).filter(x=>typeof x==='string'&&x.startsWith(photoRoot)))].slice(0,10)};
 }
 function profileId(value){
  const s=clean(value);if(/^[0-9]{5,25}$/.test(s))return s;
  try{const u=new URL(s);if(!['www.facebook.com','facebook.com','m.facebook.com'].includes(u.hostname)||u.protocol!=='https:')return '';
   const id=u.searchParams.get('id')||u.pathname.match(/^\/(?:profile\/)?([0-9]{5,25})\/?$/)?.[1];return /^[0-9]{5,25}$/.test(id||'')?id:'';
  }catch{return '';}
 }
 const api={issues,refreshCopy,profileId,photoRoot};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PostingCopy=api;
})(typeof globalThis==='object'?globalThis:this);
